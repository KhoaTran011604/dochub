# Phase 03 - Document Editor (BlockNote) Backend + Frontend

## Context Links
- [plan.md](plan.md) | [phase-02](phase-02-permission-engine.md) | [research-01 Topic 1](research/researcher-01-editor-and-permission-engine.md) | [wireframes: editor](wireframes.md)

## Overview
- Priority: P1 | Status: pending | Effort: 24h
- Page document CRUD, content save w/ optimistic concurrency, file/image upload, BlockNote editor + read-only viewer component (reused by Phase 6 publish).
- Backend part: after Phase 2. Frontend part: after Phase 0 approval + Phase 7A shell.

## Key Insights
- BlockNote stores block array JSON → `documents.content jsonb` as-is. No collab in MVP → last-write protection via `version` (409 on mismatch) instead of Yjs.
- Same `<DocumentViewer>` (BlockNote `editable={false}`) for in-app read-only (viewer role) and public view → DRY.
- BlockNote `uploadFile` hook → our files API; public view needs images too → file access checked by node permission OR share token (Phase 6).
- `@blocknote/server-util` converts blocks↔markdown server-side (needed by Phase 5 AI).
- Stored JSON rendered by React (no raw HTML), but link `href`s can carry `javascript:` → sanitize server-side.

## Requirements
- Functional:
  - Create page doc under folder/project (editor on parent) → node(type=document) + documents(doc_type=page, content=[]).
  - Get doc (viewer): node meta + content + version + effectiveRole.
  - Save content (editor): `PUT` with `{content, version}`; 409 `VERSION_CONFLICT` returns latest version meta.
  - Upload file (editor on doc): images/pdf, ≤10MB; returns URL `/api/files/:id`.
  - Frontend: debounced autosave (1.5s idle + on blur/unmount), save status indicator, conflict banner (reload / overwrite-copy), read-only mode if role=viewer.
- Non-functional: content body limit 5MB; editor chunk lazy-loaded.

## Architecture
```
BlockNoteView ──(debounced)──> useSaveDocumentContent (mutation) ──PUT /api/documents/:id/content {content,version}
                                                         └─ api: guard(editor) → sanitize → UPDATE ... WHERE version=$v RETURNING version+1
Image paste ──> uploadFile() ──POST /api/documents/:id/files (multipart) → FileStorage.put → files row → URL
```
- `FileStorage` interface { put, getStream, delete } + `s3-file-storage.ts` impl targeting **MinIO** (S3-compatible: `@aws-sdk/client-s3`, `S3_FORCE_PATH_STYLE=true`, bucket/endpoint/keys from env). `local-disk-file-storage.ts` kept only as a test double (no infra needed for unit tests) — never selected in dev/prod.
- `GET /api/files/:id`: authed user with ≥viewer on file's owning node, or valid share token param (Phase 6 adds). Files store `node_id` of owning doc (add column in migration) for check.

API:
| Method | Path | Role |
|---|---|---|
| POST | /documents (`{parentId,title,docType:'page'}`) | editor on parent |
| GET | /documents/:id | viewer |
| PUT | /documents/:id/content | editor |
| POST | /documents/:id/files | editor |
| GET | /files/:id | viewer on owning node |

## Related Code Files (create)
- `apps/api/src/modules/documents/`: `documents-repository.ts`, `documents-service.ts`, `documents-routes.ts`, `blocknote-content-sanitizer.ts`
- `apps/api/src/modules/files/`: `file-storage-interface.ts`, `s3-file-storage.ts` (MinIO, prod/dev), `local-disk-file-storage.ts` (tests only), `files-service.ts`, `files-routes.ts`
- `apps/api/src/lib/blocknote-markdown-converter.ts` (server-util wrapper; used by Phase 5)
- `packages/shared/src/schemas/document-schemas.ts`
- Migration: add `files.node_id` fk cascade
- `apps/web/components/documents/document-editor.tsx`, `document-viewer.tsx` (shared read-only), `document-save-status-indicator.tsx`, `document-conflict-banner.tsx`
- `apps/web/hooks/use-debounced-autosave.ts`
- `apps/web/queries/documents/queries.ts`, `apps/web/queries/documents/mutations.ts`; keys added to `apps/web/queries/keys.ts`
- `apps/web/pages/document-page.tsx` (switches page vs form by docType; form branch Phase 4)

## Implementation Steps
Backend
1. Shared TypeBox schemas: create-document body, document response, save-content body (`content: array`, `version: integer`).
2. `blocknote-content-sanitizer.ts`: walk blocks recursively; drop link hrefs not `http(s):`/`mailto:`; strip unknown block types? (keep BlockNote default set whitelist); enforce max depth/size.
3. Repository/service: create page (tx via tree-repository + documents row), get, save with `WHERE version=$v` → 0 rows ⇒ 409.
4. Files: `@fastify/multipart` (limits 10MB, 1 file), mime whitelist (png,jpg,gif,webp,pdf) verified via magic bytes (`file-type`), random storage key, stream to MinIO via `PutObjectCommand`; serve via `GetObjectCommand` stream (not presigned redirect, so the existing ≥viewer guard on `GET /files/:id` stays the single enforcement point) with `Content-Type` from row, `Content-Disposition` for non-images, `X-Content-Type-Options: nosniff`.
5. `blocknote-markdown-converter.ts` using `ServerBlockNoteEditor` (`blocksToMarkdownLossy`, `tryParseMarkdownToBlocks`) + unit test.
6. Integration tests: role gates, 409 conflict, sanitizer, upload limits.
Frontend (after Phase 0 + 7A)
7. Keys: `queryKeys.documents.detail(id)` (in `queries/keys.ts`). `useDocument<T>(id)`; `useCreateDocument`, `useSaveDocumentContent` (invalidate/`setQueryData` only; callbacks for UI).
8. `document-editor.tsx`: `useCreateBlockNote({ initialContent, uploadFile })`, `@blocknote/shadcn` view; onChange → `use-debounced-autosave`; track version from last save response.
9. `document-viewer.tsx`: same init, `editable={false}`, no upload; props `{ content, resolveFileUrl? }` (Phase 6 passes token-aware URL resolver).
10. Status indicator (saving/saved/error), conflict banner (reload latest; "save my copy as new page").
11. Lazy-load editor route chunk; compile + lint.

## Todo List
- [ ] Shared document schemas
- [ ] Content sanitizer + tests
- [ ] Documents repo/service/routes (409 concurrency)
- [ ] File storage interface + MinIO (S3) impl + routes
- [ ] Server-side markdown converter
- [ ] Web: queries/mutations + keys
- [ ] Web: editor w/ autosave + upload
- [ ] Web: shared read-only viewer
- [ ] Conflict + status UI

## Success Criteria
- Create page, type, reload → content persisted; viewer role sees read-only; two tabs editing → second save gets 409 banner, no silent overwrite.
- Pasted image uploaded + rendered; `javascript:` link stripped on save.

## Risk Assessment
- BlockNote version churn / breaking JSON shape → pin exact versions; store `content` as-is; upgrade in isolated PR with fixture docs test.
- Large docs slow autosave → debounce + 5MB limit; revisit patch-based save only if needed.
- Lost edits on tab close → `beforeunload` flush + warning if unsaved.

## Security Considerations
- Guard on every route; sanitize links; files served with nosniff and never as HTML/SVG (SVG excluded from whitelist → XSS).
- Upload size + count limits; storage keys random, not user filenames (no path traversal).

## Next Steps
- Phase 5 uses markdown converter; Phase 6 reuses `document-viewer.tsx` + extends file access with share token.
