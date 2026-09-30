# Phase 04 - Dynamic Template System

## Context Links
- [plan.md](plan.md) | [phase-02](phase-02-permission-engine.md) | [research-02 Topics 1-2](research/researcher-02-fastify-jsonschema-queue.md) | [wireframes: template form view](wireframes.md)

## Overview
- Priority: P1 | Status: pending | Effort: 20h
- Templates CRUD (system admin, immutable versions), `form` documents validated server-side by AJV against stored JSONB schema, rendered client-side by RJSF using same schema + `ui_schema`.
- Backend after Phase 2; frontend after Phase 0 + 7A (GenericForm already RJSF-based).

## Key Insights
- Schemas are runtime data → cannot be compiled into Fastify route schemas at startup. Route validates envelope (static TypeBox); `data` validated in service by shared AJV instance with **same options as Fastify's AJV** (one exported `ajv-options.ts`) → identical behavior, DRY.
- AJV compiles to `new Function` → template schema = code. Restrict authoring to system admins + meta-validate + forbid remote `$ref`.
- Immutable versioning: editing template = insert version+1, flip `is_latest`. Form docs pin `template_id` (a specific version) → old docs stay valid; compiled-validator cache keyed by id never goes stale.
- RJSF v6 handles conditionals via JSON Schema `if/then/else`, `dependencies`, `oneOf` natively — no custom widgets needed for MVP.

## Requirements
- Functional:
  - System admin: list/create template, create new version, deactivate; preview form live while editing (JSON editor for schema + ui_schema, RJSF preview side-by-side).
  - Templates filtered by `project_type`; project's type selects which templates offered.
  - Create form doc (editor on parent): pick latest template of project type → node + documents(doc_type=form, template_id, form_data={}).
  - Save form data (editor): `{data, version}` → AJV validate against pinned template → 422 with AJV errors mapped to `{path,message}`; 409 on version mismatch. Only allowed while `status='draft'`.
  - Submit (editor): validates data, sets `status='submitted'` → subsequent saves 409 `FORM_SUBMITTED` unless reopened; viewers always read-only.
  - Reopen (editor/admin): sets `status='draft'` again, editable.
  - Optional "upgrade to latest template version": validate current data vs new schema; if valid switch `template_id`, else 422 with errors.
- Non-functional: validator compile cached (LRU 200); schema size ≤ 256KB; validation < 10ms typical.

## Architecture
```
[Admin] RJSF preview  ←─ schema/ui_schema ─→  POST /api/admin/templates  → meta-validate(draft-07 + restrictions) → insert v1
[Editor] RJSF form (GenericForm) ──PUT /api/documents/:id/form-data {data,version}
   api: guard(editor) → load doc.template_id → validatorCache.get(id) ?? ajv.compile(schema) → validate → save (version check)
```
Restrictions check (`template-schema-guard.ts`): root `type: object`; no `$ref` except local `#/...`; no `$id` with remote URL; max depth 10; disallow `format` values not in ajv-formats.

API:
| Method | Path | Role |
|---|---|---|
| GET | /templates?projectType= | authed (latest only) |
| GET | /templates/:id | authed |
| POST | /admin/templates | system admin |
| POST | /admin/templates/:key/versions | system admin |
| PATCH | /admin/templates/:key (deactivate) | system admin |
| POST | /documents (`docType:'form'`, `templateId`) | editor on parent |
| PUT | /documents/:id/form-data | editor, status=draft only |
| POST | /documents/:id/submit | editor |
| POST | /documents/:id/reopen | editor |
| POST | /documents/:id/upgrade-template | editor |

## Related Code Files (create)
- `packages/shared/src/validation/ajv-options.ts` (used by Fastify `ajv.customOptions`, dynamic api validator, and web RJSF `customizeValidator`), `apps/api/src/lib/json-schema-validator-cache.ts`
- `apps/api/src/modules/templates/`: `templates-repository.ts`, `templates-service.ts`, `templates-routes.ts`, `template-schema-guard.ts`
- `apps/api/src/modules/documents/form-documents-service.ts` (keeps documents-service <200 lines), routes added to `documents-routes.ts`
- `packages/shared/src/schemas/template-schemas.ts`, `form-document-schemas.ts`
- `apps/web/queries/templates/queries.ts`, `apps/web/queries/templates/mutations.ts`; extend `queries/documents/mutations.ts` (`useSaveFormData`)
- `apps/web/components/documents/form-document-view.tsx` (uses GenericForm; readOnly mode reused by Phase 6)
- `apps/web/pages/admin/templates-list-page.tsx`, `apps/web/pages/admin/template-editor-page.tsx`, `apps/web/components/templates/template-schema-json-editor.tsx`
- Modify: `apps/api/src/app.ts` (ajv customOptions), `apps/web/pages/document-page.tsx` (form branch)

## Implementation Steps
Backend
1. `ajv-options.ts`: `{ allErrors: true, strict: true, coerceTypes: false, removeAdditional: false, useDefaults: true }` + ajv-formats; register in Fastify and dynamic AJV.
2. `template-schema-guard.ts`: `ajv.validateSchema` (draft-07 meta) + restriction walk; unit tests with malicious schemas (remote $ref, huge, non-object root).
3. Templates repo/service: create (key unique, v1, is_latest), newVersion (tx: lock rows of key, insert v+1, flip flags), deactivate (is_latest rows hidden from pickers; existing docs unaffected), list/get.
4. `json-schema-validator-cache.ts`: LRU keyed by template id → compiled fn.
5. Form docs: create (template must be latest + match project type, `status` defaults `draft`), save data (validate → 422 map errors `instancePath`→path, reject if `status='submitted'`), submit (validate + set `status='submitted'`), reopen (editor/admin, set `status='draft'`), upgrade-template.
6. Integration tests: valid/invalid data, pinned version after template update, upgrade success/fail, non-admin blocked.
Frontend
7. Template queries/mutations (keys: `queryKeys.templates.list(projectType)`, `.detail(id)` in `queries/keys.ts`).
8. `form-document-view.tsx`: `GenericForm` with `schema`, `uiSchema`, `formData`; submit → `useSaveFormData` with callbacks; map server 422 errors to RJSF `extraErrors`; `readOnly` prop for viewer/public.
9. Admin template editor: two JSON editors (textarea w/ JSON parse errors; no heavy code editor YAGNI) + live GenericForm preview; save = new version.
10. Compile + lint.

## Todo List
- [ ] Shared ajv options (Fastify + dynamic)
- [ ] Template schema guard + malicious-schema tests
- [ ] Templates repo/service/routes (versioning)
- [ ] Validator cache
- [ ] Form docs create/save/submit/reopen/upgrade + tests
- [ ] Web: template queries/mutations
- [ ] Web: form-document-view (edit + readOnly)
- [ ] Web: admin template list/editor w/ preview

## Success Criteria
- Admin edits schema (adds field) → new docs show field immediately, no deploy; old docs still load/save against pinned version.
- Invalid data rejected server-side even if client validation bypassed (curl test).
- Client (RJSF validator-ajv8) and server produce same verdict on fixture set.

## Risk Assessment
- Client/server AJV option mismatch → same options object exported from shared package to RJSF `customizeValidator`; fixture parity test.
- Template sprawl/versions → `is_latest` pickers hide old; fine at scale.
- Complex schemas beyond RJSF default widgets → out of scope; custom widgets only when requested.

## Security Considerations
- Only system admins author schemas; meta + restriction validation; no remote refs (no SSRF / arbitrary fetch).
- AJV `strict` prevents unknown keywords; validation errors don't echo full data.
- `form_data` rendered via RJSF (React-escaped); no HTML widgets allowed in ui_schema (`ui:widget` whitelist).

## Next Steps
- Phase 5 uses template fields + form data as AI generation input; Phase 6 renders form docs read-only via `form-document-view`.
