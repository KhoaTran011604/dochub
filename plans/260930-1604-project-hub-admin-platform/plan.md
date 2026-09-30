---
title: "Project Document Hub & Client Publish Platform"
description: "Greenfield Fastify+Postgres+React admin platform: project-rooted doc tree, Notion-style inherited ACL, dynamic templates, AI gen/summarize, branded public publish."
status: pending
priority: P2
effort: 200h
branch: main
tags: [greenfield, fastify, postgres, react, blocknote, rjsf, bullmq, acl, ai]
created: 2026-09-30
---

# Project Document Hub - Implementation Plan

## Overview
Internal admin platform (10-50 projects, 20-100 users). `Project` → nested `Folder` → `Document` (`page`=BlockNote JSON, `form`=template-validated JSONB). Node-based ACL with nearest-explicit-grant inheritance. Dynamic templates (JSON Schema in JSONB) shared by AJV (api) + RJSF (web). AI draft gen + multi-doc summarize via BullMQ. Public branded read-only share link.

Inputs: [brainstorm](../reports/brainstorm-260930-1604-project-hub-admin-platform.md) | [research-01 editor+ACL](research/researcher-01-editor-and-permission-engine.md) | [research-02 fastify+rjsf+queue](research/researcher-02-fastify-jsonschema-queue.md) | [wireframes](wireframes.md)

## Stack (locked + planner picks marked *)
- Monorepo *pnpm workspaces: `apps/api`, `apps/web`, *`packages/shared` (TypeBox schemas, enums, types)
- api: Fastify 5, *TypeBox type provider, *Drizzle ORM + drizzle-kit migrations, Postgres 16, Redis 7 + BullMQ, **MinIO (S3-compatible file storage, `@aws-sdk/client-s3`)**, AJV 8, *argon2, *`@blocknote/server-util`, `@anthropic-ai/sdk` (Claude proxy)
- web: *Vite + React, TanStack Query 5, *React Router 7, *Tailwind + shadcn/ui, BlockNote (`@blocknote/shadcn`), `@rjsf/core` v6 (+ *`@rjsf/shadcn`), *TanStack Table
- tests: *Vitest (unit+integration on real Postgres/Redis via docker compose), *Playwright (1 golden e2e)

## Key design decisions (planner)
- Single `nodes` table (type = project|folder|document) + 1:1 detail tables → one ACL/closure mechanism for all levels.
- Roles ordered `none < viewer < editor < admin`; explicit `none` = block inheritance (Notion "restrict").
- **GenericForm wraps RJSF** → one form engine for static admin forms and dynamic templates (DRY); static TypeBox schemas shared api↔web.
- Templates immutable-versioned; form docs pin `template_id` → schema edits never invalidate old docs, no deploy needed.
- Auth: `users` + `user_identities(provider, subject)` → SSO later = new provider row, no schema change.
- Delete = soft (`nodes.deleted_at`), cascaded to subtree; restore un-sets it; hard delete is a separate system-admin-only "permanent delete" action. Public share visibility excludes trashed nodes automatically.
- File storage = MinIO (S3-compatible) from day one via `FileStorage` interface (`s3-file-storage.ts`); local-disk impl kept only as a test double.
- Project creation restricted to system admin (already reflected in Phase 2's `POST /projects` guard).
- AI proxy confirmed Anthropic Messages-compatible: `ANTHROPIC_BASE_URL=https://proxy-api.hdwebsoft.co/`, `ANTHROPIC_AUTH_TOKEN` (secret, via gitignored `.env`, never committed) — use `@anthropic-ai/sdk` directly.
- Repo: `git init` + `.gitignore` (`.claude/`, `.env*` except `.env.example`) as the very first implementation step, before any other file is created.

## Phases
| # | Phase | Status | Effort | Depends |
|---|-------|--------|--------|---------|
| 0 | [Wireframes & UI/UX review](phase-00-wireframes-and-uiux-review.md) | approved | 4h | - |
| 1 | [Foundation, data model, migrations, auth](phase-01-foundation-data-model-and-auth.md) | pending | 28h | - |
| 2 | [Permission engine](phase-02-permission-engine.md) | pending | 22h | 1 |
| 3 | [Document editor (BlockNote)](phase-03-document-editor-blocknote.md) | pending | 24h | 2 (+0,7A for UI) |
| 4 | [Dynamic template system](phase-04-dynamic-template-system.md) | pending | 20h | 2 (+0,7A for UI) |
| 5 | [AI service layer + jobs](phase-05-ai-service-layer-and-jobs.md) | pending | 20h | 3,4 |
| 6 | [Public publish](phase-06-public-publish.md) | pending | 18h | 3,4 (+0,7A) |
| 7 | [Frontend admin app](phase-07-frontend-admin-app.md) | pending | 34h | 0, 1-2 APIs |
| 8 | [Testing](phase-08-testing.md) | pending | 26h | all (runs alongside) |

## Sequencing
- Backend track: 1 → 2 → {3,4 parallel} → {5,6 parallel}. Not blocked by Phase 0.
- Frontend track: Phase 0 approval gates ALL `apps/web` work. Then 7A (app shell/infra) → UI parts of 3/4/6 → 7B (management screens) → 5 UI.
- Phase 8: unit/integration tests written inside each phase; Phase 8 = hardening, edge-case matrix, e2e, CI.

## MVP out of scope (YAGNI)
Real-time collab, SSO impl, custom domains, RAG/vector search, mobile, doc revision history, trash/soft-delete, groups/teams ACL, full-text search.

## Success criteria (end-to-end)
Create project → add folder/page/form doc → set subtree permission → publish branded link → anonymous view works. Template schema change live w/o deploy. AI draft < 30s.

## Resolved (post-brainstorm validation, 2026-09-30)
1. **Claude proxy**: Anthropic-compatible, `ANTHROPIC_BASE_URL=https://proxy-api.hdwebsoft.co/` + `ANTHROPIC_AUTH_TOKEN` (secret, supplied via ops-managed `.env`, gitignored — token value never pasted into chat/plan). Rate limit/cost budget still TBD with ops before enabling `summarize` in prod (Phase 5 risk item).
2. **Project creation**: system admin only (already Phase 2's design, confirmed not "any user").
3. **Publish granularity**: always whole shared subtree, no per-node "exclude from publish" flag — confirms existing design, no change needed.
4. **Deletion**: trash/restore (soft delete) required, not hard-delete-only. Phases 1/2/6 updated: `nodes.deleted_at`, restore/permanentDelete endpoints, public view auto-excludes trashed nodes.
5. **File storage**: MinIO (S3-compatible) from MVP, not local-disk-then-later. Phase 3 updated to implement `s3-file-storage.ts` as the real impl.
6. **Git**: repo gets `git init` now; `.gitignore` excludes `.claude/` and all secret/env files (`.env*` except `.env.example`).

## Unresolved Questions
1. SSO provider (Google Workspace / Entra ID / other) — affects only a future provider adapter, no schema change needed now.
2. Custom domain per project: later phase, or never? (MVP ships without it regardless.)
3. Groups/teams as ACL principals needed soon? (would add `principal_type` column — not needed for MVP.)
4. Doc revision history needed before go-live? (MVP ships without it.)
5. Share tokens stored hashed → link copyable only at creation (regenerate if lost) — kept as designed (no objection raised); revisit only if real usage complains.

## Validation Log

### Session 1 — 2026-09-30
**Trigger:** Initial plan validation, right after plan creation (brainstorm → plan:hard → plan:validate in one sitting).
**Questions asked:** 4

#### Questions & Answers

1. **[Architecture]** Postgres/Redis/MinIO trong môi trường production (self-hosted VPS) sẽ dùng hạ tầng nào?
   - Options: Docker-compose riêng cho app này (Recommended) | Dùng chung hạ tầng công ty có sẵn
   - **Answer:** Docker-compose riêng cho app này
   - **Rationale:** Confirms Phase 1's `docker-compose.yml` (postgres+redis+minio) is the actual prod topology too, not just dev — no separate infra handoff needed before deploy.

2. **[Architecture]** apps/web và apps/api sẽ deploy cùng domain (qua reverse proxy) hay khác domain/subdomain?
   - Options: Cùng domain qua reverse proxy (Recommended) | Khác domain/subdomain
   - **Answer:** Cùng domain qua reverse proxy
   - **Rationale:** Keeps session cookie `SameSite=Lax` (already Phase 1's design) sufficient — no cross-origin CORS/cookie rework needed.

3. **[Scope]** Version control host cho repo này (ảnh hưởng Phase 8 CI setup)?
   - Options: GitHub | GitLab | Chưa cần remote, chỉ local git trước
   - **Answer:** GitHub
   - **Rationale:** Phase 8's CI file is concretely GitHub Actions (`.github/workflows/ci.yml`), not a placeholder.

4. **[Risk]** Tính năng AI summarize cần xác nhận rate-limit/cost của Claude proxy trước khi bật cho user thật — xử lý thế nào trong Phase 5?
   - Options: Build đủ cả 2 job, feature-flag tắt summarize mặc định (Recommended) | Build cả 2, không cần flag, dựa vào rate-limiter code
   - **Answer:** Build đủ cả 2 job, feature-flag tắt summarize mặc định
   - **Rationale:** Decouples "code complete" from "safe to expose to real users" — avoids a surprise cost spike before ops confirms proxy limits, without blocking Phase 5 development.

#### Confirmed Decisions
- Prod infra: dedicated docker-compose (postgres+redis+minio) on the VPS, same as dev.
- Cookie/CORS: same-origin via reverse proxy, `SameSite=Lax` stands, no cross-origin auth work.
- CI: GitHub Actions.
- AI summarize: shipped code-complete but env-gated off (`AI_SUMMARIZE_ENABLED=false`) until ops confirms proxy limits.

#### Action Items
- [x] Phase 1: reverse-proxy/same-domain deployment note added to Architecture.
- [x] Phase 8: CI file confirmed as GitHub Actions, trigger on PR + push to main.
- [x] Phase 5: `AI_SUMMARIZE_ENABLED` env flag + 403 `FEATURE_DISABLED` gate added.
- [ ] Before flipping `AI_SUMMARIZE_ENABLED=true` in prod: get proxy rate-limit/cost confirmation from ops.

#### Impact on Phases
- Phase 1: Architecture section — added deployment topology note (done).
- Phase 5: Requirements + Architecture + Implementation Steps — added feature flag (done).
- Phase 8: Related Code Files + Implementation Steps — CI confirmed GitHub Actions (done).

### Session 2 — 2026-09-30
**Trigger:** Phase 0 wireframes stakeholder review (`/cook phase-00-wireframes-and-uiux-review.md`).
**Questions asked:** 7 (3 open product questions from wireframes.md + 4 API-coverage gaps surfaced by cross-check)

#### Confirmed Decisions
- Publish scope: single project-level toggle (whole shared subtree) — reconfirms plan.md decision #3.
- Share invite: email + role, multi-email in one invite; no org-picker/separate external-link flow.
- Public view: reserve `comments` table as unwired placeholder for future "request change" (reopens MVP-out-of-scope item narrowly — schema only, no routes/UI).
- Dashboard: add `projects.status` (active/draft/archived) + reuse `PATCH /projects/:id` for archive; doc count/owner confirmed derivable from existing fields.
- Form docs: add `documents.status` (draft/submitted) + submit/reopen endpoints.
- Trash/Restore: add Trash panel to screen 2 wireframe (backend already existed).
- Dropped (YAGNI, no endpoint): project/node duplicate actions, editor inline comments.

#### Action Items
- [x] Phase 1: `projects.status`, `documents.status`, `comments` placeholder table added to schema.
- [x] Phase 2: `PATCH /projects/:id` status transitions + `GET /projects` aggregate fields documented.
- [x] Phase 4: submit/reopen endpoints + status-gated save added.
- [x] wireframes.md: Review Decisions section added, status → approved.

#### Impact on Phases
- Phase 0: status `review` → `approved`. Unblocks Phase 7A.
- Phase 1, 2, 4: schema/endpoint additions above (done).
