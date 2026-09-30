# Dynamic Templates & Form Builders Research

## 1. NocoDB
**What**: Self-hosted Airtable alternative; transforms existing databases (MySQL, PostgreSQL, etc) into smart spreadsheet UI.
**License**: Fair Code Sustainable Use (free for internal use; commercial license needed if offering as managed service).
**Node.js Compat**: Written in Node.js/Vue stack.
**Embeddability**: Primarily **standalone**. Exposes REST API for external consumption. Not designed as embedded library into custom NestJS app.
**Pros**: Fast setup, rich UI out-of-box, handles multiple DB backends.
**Cons**: Overkill for simple document templates; architecture divorce from custom app logic; licensing ambiguity if SaaS intent.

## 2. Baserow
**What**: Open-source database/no-code platform; REST API-first architecture; GDPR/HIPAA compliant.
**License**: MIT (formerly AGPL).
**Node.js Compat**: Python/Django backend; talks via REST API.
**Embeddability**: **Standalone service** with REST API. Not an embedded library.
**Pros**: Extensible, API-first, enterprise compliance.
**Cons**: Separate service to deploy/maintain; Python backend adds operational overhead for Node.js team; larger scope than needed.

## 3. Payload CMS
**What**: Headless Node.js/TypeScript CMS; code-first, schema-based, supports JSON fields with full JSON Schema validation.
**License**: MIT.
**Node.js Compat**: **Native TypeScript/Node.js**; can run as library or standalone.
**Embeddability**: **High** — can be embedded as npm library into NestJS app or run standalone.
**Pros**: Native TS/Node; flexible schema; JSONB field support; can sit in same repo; automatic type generation.
**Cons**: Full CMS overhead (user mgmt, publishing workflows, asset mgmt); more than a form-builder; learning curve.

## 4. JSON Schema + Form Renderer (RJSF, Uniforms, Formily)
**What**: Frontend libraries render forms directly from JSON Schema + uiSchema; backend stores schema definitions in JSONB column.
**License**: MIT (all three).
**Node.js Compat**: Frontend-only; works with any backend.
**Embeddability**: **Direct library integration**. Import into React frontend; backend serves schema JSON.
**Pros**: Minimal overhead; pure YAGNI; flexible UI customization; Postgres JSONB native support; fastest to MVP.
**Cons**: Schema editor UI requires custom build; validation logic split between backend & frontend; uiSchema duplication for UI customization.

## 5. Other Notable Patterns
- **OpenForms**: Form-only builder (no DB management); requires external backend.
- **Form.io**: Form platform closer to Baserow; not recommended (heavier, SaaS-focused).
- **Custom NestJS + JSONB**: Lightweight modules for schema validation & API; allows precise control.

---

## Comparison Matrix

| Criteria | NocoDB | Baserow | Payload CMS | JSON Schema Libs | Custom |
|----------|--------|---------|-------------|------------------|--------|
| Standalone | Yes | Yes | Both | No | No |
| Node.js Native | Yes | No | Yes | N/A (FE) | Yes |
| Embeddable | No | No | Yes | Yes | Yes |
| JSONB Support | Via API | Via API | Native JSON field | Via backend | Native |
| Licensing Risk | Fair Code ⚠️ | MIT ✓ | MIT ✓ | MIT ✓ | N/A |
| Setup Time | 1-2 days | 2-3 days | 3-5 days | 1-2 weeks | 2-3 weeks |
| Maintenance Overhead | Medium | High | Medium | Low | Medium |

---

## Recommendation

**For your use case, adopt: JSON Schema + RJSF (or Formily) + PostgreSQL JSONB + custom backend validation.**

**Rationale** (3 sentences):
1. **YAGNI**: NocoDB/Baserow are full platforms; Payload is a full CMS. You need form rendering + flexible schema storage—nothing more. JSON Schema libs nail this: define schema in JSONB, render on frontend, validate on backend (NestJS). Ship in 2-3 weeks vs 4-6 for a full platform.
2. **KISS**: No separate service deployment, no Python ops overhead, no licensing ambiguity. Schema is code (TypeScript interfaces auto-generated from JSONB). Frontend dev ≈ one form library integration. Backend ≈ schema validation + CRUD endpoints.
3. **DRY**: Store schema once (JSONB in Postgres); derive UI (RJSF), validation (JSON Schema validator lib), and types (ts-json-schema-generator). One source of truth. Alternative (Payload) requires learning Payload's ecosystem; alternative (NocoDB/Baserow) requires maintaining separate deployment.

**Implementation path**: Create `templates` table (id, project_type, schema: JSONB, ui_schema: JSONB). Expose GET `/templates/:type` → frontend renders via RJSF. Validate submissions via `ajv` (Node.js JSON Schema validator) before storing document. Extend templates via admin panel (custom React component or simple JSON editor UI).

---

## Sources

- [NocoDB Self-Hosting Docs](https://nocodb.com/docs/self-hosting)
- [NocoDB GitHub](https://github.com/nocodb/nocodb)
- [Baserow GitHub](https://github.com/baserow/baserow)
- [Payload CMS Docs - JSON Field](https://payloadcms.com/docs/fields/json)
- [Payload CMS Review 2026](https://www.luckymedia.dev/insights/payload-cms)
- [Schema-Driven Forms Comparison](https://dev.to/yanggmtl/schema-driven-forms-in-react-comparing-rjsf-json-forms-uniforms-formio-and-formitiva-2fg2)
- [React JSONSchema Form GitHub](https://github.com/rjsf-team/react-jsonschema-form)
- [NestJS + PostgreSQL JSONB with Drizzle ORM](http://wanago.io/2024/07/15/api-nestjs-json-drizzle-postgresql/)
- [OpenForms - Dynamic Form Builder](https://medium.com/@hfps/meet-openforms-a-free-open-source-dynamic-form-builder-that-can-run-anywhere-905353eb026b)
