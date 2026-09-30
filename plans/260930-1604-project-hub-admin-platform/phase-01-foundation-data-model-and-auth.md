# Phase 01 - Foundation, Data Model, Migrations & Auth

## Context Links
- [plan.md](plan.md) | [research-01 (ACL schema)](research/researcher-01-editor-and-permission-engine.md) | [research-02 (Fastify/AJV)](research/researcher-02-fastify-jsonschema-queue.md)
- `.claude/rules/development-rules.md` (kebab-case, <200 lines/file)

## Overview
- Priority: P1 | Status: pending | Effort: 28h
- Monorepo scaffold, Fastify app skeleton + module convention, full Postgres schema + migrations, tree repository (closure/path maintenance), email/password auth with pluggable provider design, user admin.

## Key Insights
- Single `nodes` table for project/folder/document → one closure table, one ACL table, one resolver. Detail data in 1:1 tables.
- Materialized `path` (`/<projectId>/<folderId>/.../<id>/`) = cheap subtree ops (`LIKE path || '%'`); `node_closure` = O(1) ancestor lookup w/ depth. Both maintained in same transaction by tree repository only.
- No NestJS DI → need explicit convention now: each module = Fastify plugin + plain factory services; composition root wires deps (no DI lib).
- Drizzle chosen: TS schema, generated reviewable SQL migrations, raw `sql` tag for CTE/closure queries.
- SSO-ready: identity separate from user. `user_identities(provider, provider_subject)`; password = provider `password`. OIDC later = new provider adapter + rows, no schema change.

## Requirements
- Functional: login/logout/me; system admin creates/disables users, resets password; user search (for permission panel); seed first admin from env.
- Tree repository: createNode, moveNode (cycle-safe, same project only), deleteNode (**soft-delete**, cascades `deleted_at` to whole subtree via closure, in one tx), restoreNode (clears `deleted_at` on subtree; 409 "restore parent first" if parent still trashed), permanentDeleteNode (**system admin only**, hard delete via FK cascade, irreversible), listChildren (excludes trashed by default), getAncestors.
- Non-functional: files <200 lines; env validated at boot; structured logs (pino) w/ request id; one-command local stack (docker compose).

## Architecture
Monorepo:
```
apps/api  apps/web(Phase 7A)  packages/shared  docs/  docker-compose.yml
```
**Deployment topology (confirmed):** self-hosted VPS, same docker-compose stack (postgres/redis/minio + api + web build) used in dev is also what prod runs — no separate managed infra. `web` and `api` served under **one domain via reverse proxy** (e.g. Caddy/Nginx: `/` → web static build, `/api` → Fastify) so session cookies stay same-origin `SameSite=Lax` (no cross-origin CORS/cookie complexity needed — matches step 9's cookie config as-is).
API module convention: `src/modules/{domain}/{domain}-routes.ts | -service.ts | -repository.ts`; route schemas from `packages/shared`. `src/app.ts` = buildApp(deps) (testable), `src/server.ts` = listen. Services receive `{ db, logger, ... }` via factory; decorated on fastify as `app.services.*`.

Schema (Postgres 16, uuid pk via `gen_random_uuid()`):
| Table | Key columns |
|---|---|
| users | id, email citext unique, display_name, is_system_admin bool, status (active/disabled), timestamps |
| user_identities | id, user_id fk, provider text, provider_subject text, password_hash null; unique(provider, provider_subject) |
| sessions | id = sha256(token) pk, user_id fk, expires_at, created_at, ip, user_agent |
| nodes | id, project_id fk nodes, parent_id fk nodes null ON DELETE CASCADE, type enum(project/folder/document), title, path text, depth int, position int, created_by, timestamps, **deleted_at timestamptz null** (soft-delete/trash); CHECK(type='project' ⇔ parent_id IS NULL AND project_id=id) |
| node_closure | ancestor_id, descendant_id, depth; pk(ancestor,descendant); idx(descendant_id, depth); FKs cascade; includes self row depth 0 |
| projects | node_id pk fk, project_type text, description, logo_file_id null, theme_color text CHECK hex |
| documents | node_id pk fk, doc_type enum(page/form), content jsonb null, form_data jsonb null, template_id fk null, version int default 1, updated_by, updated_at; CHECK page⇒content, form⇒template_id |
| templates | id, key text, version int, project_type, name, schema jsonb, ui_schema jsonb, is_latest bool, created_by, created_at; unique(key,version) |
| node_permissions | node_id fk cascade, user_id fk cascade, role enum(none/viewer/editor/admin), granted_by, created_at; pk(node_id,user_id) |
| share_links | id, node_id fk cascade, token_hash unique, created_by, created_at, revoked_at null, expires_at null |
| files | id, project_id fk, storage_key, mime, size_bytes, original_name, uploaded_by, created_at |

Indexes: nodes(parent_id, position), nodes(project_id), nodes(path text_pattern_ops), node_permissions(user_id), templates(project_type) WHERE is_latest.

## Related Code Files (create)
- Root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `docker-compose.yml` (postgres16, redis7), `eslint.config.js`
- `packages/shared/src/`: `index.ts`, `enums/node-type-enum.ts`, `enums/node-role-enum.ts` (+ `roleRank`), `schemas/auth-schemas.ts`, `schemas/user-schemas.ts`, `schemas/common-schemas.ts` (uuid, pagination, error)
- `apps/api/`: `package.json`, `tsconfig.json`, `drizzle.config.ts`
- `apps/api/src/`: `server.ts`, `app.ts`, `config/env-config.ts`, `db/db-client.ts`, `db/schema/{users,nodes,documents,templates,permissions,share-links,files}-schema.ts`, `db/schema/index.ts`, `db/migrations/*` (generated + 1 custom SQL for citext/checks/pattern index)
- `apps/api/src/plugins/`: `error-handler-plugin.ts`, `session-auth-plugin.ts` (decorates `request.user`), `security-plugins.ts` (helmet, cors, rate-limit, cookie)
- `apps/api/src/modules/auth/`: `auth-provider-interface.ts`, `password-auth-provider.ts`, `session-service.ts`, `auth-routes.ts`
- `apps/api/src/modules/users/`: `users-repository.ts`, `users-service.ts`, `users-routes.ts`
- `apps/api/src/modules/tree/`: `tree-repository.ts` (closure+path maintenance), `tree-errors.ts`
- `apps/api/src/scripts/seed-system-admin.ts`
- `docs/code-standards.md`, `docs/system-architecture.md` (initial, via docs-manager)

## Implementation Steps
1. `git init`; add `.gitignore` (`.claude/`, `.env*` except `.env.example`, `node_modules/`, `dist/`, `.turbo/`) — do this before any other file lands, so secrets/assistant-config are never staged; pnpm workspace; Node 22 LTS, TS strict; shared tsconfig; eslint+prettier minimal.
2. `docker-compose.yml`: postgres:16 (+ `citext`, `pgcrypto`), redis:7, **minio** (S3-compatible, console+API ports, dev root creds, auto-create bucket via `mc` init container or app-boot check); `.env.example` (DATABASE_URL, REDIS_URL, SESSION_TTL_DAYS, COOKIE_SECURE, SEED_ADMIN_EMAIL/PASSWORD, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `AI_MODEL`).
   - `.gitignore`: `.claude/`, `.env`, `.env.*` (except `!.env.example`), `node_modules/`, `dist/`, `.turbo/` — secrets and assistant config never committed.
3. `packages/shared`: TypeBox schemas + enums; build as TS project refs (or source import via `exports`).
4. `env-config.ts`: validate env with TypeBox at boot; fail fast.
5. `app.ts`: Fastify 5 + TypeBox type provider; register security plugins, error handler (uniform `{error:{code,message,details}}`), `/health`.
6. Drizzle schema files per table above; `drizzle-kit generate`; add custom migration for extensions, CHECK constraints, `text_pattern_ops` index. Scripts: `db:generate`, `db:migrate`.
7. `tree-repository.ts` (all in one tx):
   - create: insert node; path = parent.path || id || '/'; depth = parent.depth+1; closure = parent's ancestor rows (depth+1) + self row.
   - move: reject if newParent in subtree (closure check) or different project; `SELECT ... FOR UPDATE` on moved node; delete closure rows linking outside-ancestors→subtree; insert cross product (newParent ancestors × subtree); update path prefix + depth for subtree via `LIKE oldPath || '%'`.
   - delete (soft): set `deleted_at=now()` on node + every descendant (ids from closure) in one tx; closure/grants/shares untouched so restore is a pure un-set. Return affected subtree ids (cache invalidation).
   - restore: clear `deleted_at` on node+descendants; reject 409 if parent still trashed.
   - permanentDelete (system admin only, separate guarded route): hard-delete → FK cascade removes subtree/closure/grants/shares; irreversible, UI requires typed confirmation.
   - Emit `onTreeMutated(nodeIds)` callback hook (Phase 2 uses for cache invalidation).
8. Auth: `AuthProvider { id; authenticate(input): Promise<{userId}|null> }`; `PasswordAuthProvider` (argon2id verify; constant-time dummy verify when user missing). `session-service`: random 32-byte token → cookie `sid` (httpOnly, sameSite=lax, secure per env); store sha256 only; sliding expiry.
9. Routes: `POST /api/auth/login` (rate-limited 5/min/ip+email), `POST /api/auth/logout`, `GET /api/auth/me`. CSRF: SameSite=lax + require `content-type: application/json` on mutations.
10. Users: `GET /api/users?q=` (authed, min 2 chars, returns id/name/email, limit 20); system-admin only `POST /api/admin/users`, `PATCH /api/admin/users/:id` (disable, reset password, toggle admin). Disabling user deletes their sessions.
11. `seed-system-admin.ts` idempotent.
12. Tests (Vitest, real Postgres): migrations apply clean; tree create/move/delete closure invariants; login/logout/disabled user; compile check `pnpm -r build`.
13. docs-manager: write `docs/code-standards.md` (module convention, naming, error format) + `docs/system-architecture.md`.

## Todo List
- [ ] Monorepo + docker compose + env validation
- [ ] Shared package (enums, TypeBox schemas)
- [ ] Fastify skeleton + plugins + error format
- [ ] Drizzle schema + migrations (incl. custom SQL)
- [ ] Tree repository w/ closure + path maintenance + soft-delete/restore/permanent-delete
- [ ] Auth provider abstraction + password provider + sessions
- [ ] Users admin + search endpoints + seed script
- [ ] Tests: closure invariants, auth flows
- [ ] docs/code-standards.md + system-architecture.md

## Success Criteria
- `docker compose up` + `pnpm db:migrate` + `pnpm dev` → login works via curl.
- Closure invariant test: for random tree ops, `node_closure` == transitive closure computed by recursive CTE on `parent_id` (oracle), and `path` consistent.

## Risk Assessment
- Closure/path drift from writes bypassing repository → only tree-repository writes `nodes.parent_id`; lint/grep rule in review; invariant test.
- Concurrent moves → row locks on moved node + target parent, ordered by id to avoid deadlock.
- Convention drift without DI → documented in code-standards before Phase 2.

## Security Considerations
- argon2id, min password length 12, no password in logs (pino redact `password`, `cookie`, `authorization`).
- Session tokens hashed at rest; logout + disable revoke server-side.
- Login rate-limit; uniform error on bad email/password (no user enumeration).
- helmet defaults; CORS restricted to web origin.

## Next Steps
- Phase 2 builds resolver + guarded tree/project routes on top of tree repository.
