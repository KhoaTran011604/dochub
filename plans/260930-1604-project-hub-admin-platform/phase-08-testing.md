# Phase 08 - Testing (Unit, Integration, E2E, CI)

## Context Links
- [plan.md](plan.md) | all phase files (each lists its own tests) | `.claude/rules/primary-workflow.md` (tester agent, no fake passes)

## Overview
- Priority: P1 | Status: pending | Effort: 26h
- Tests are written inside each phase; this phase = shared harness, edge-case matrices (permissions, templates, publish), golden e2e, CI pipeline, coverage gate.

## Key Insights
- Permission engine = highest risk → property-based oracle test (closure resolver vs recursive-CTE on `parent_id`) catches whole classes of bugs a hand matrix misses.
- Real Postgres + Redis in tests (docker compose / CI services); no DB mocks. External AI proxy replaced by a local stub HTTP server (real network path) — legitimate boundary double, not a cheat.
- `buildApp(deps)` + `app.inject()` → fast HTTP-level integration tests w/o ports.

## Requirements
- Unit: pure libs (role rank, sanitizer, schema guard, context builder, form-data→markdown, token util, tree builder, contrast util).
- Integration (api): every route's auth/role gates; edge matrices below.
- Web: component tests for GenericForm (schema→fields, readOnly, extraErrors), GenericTable, tree builder; convention lint checks.
- E2E (Playwright, 1-2 specs): golden flow.
- CI: lint, typecheck, unit, integration, e2e on PR; coverage ≥ 80% api modules, 100% branch on permission resolver/service.

## Architecture
- Vitest workspace: `apps/api` (node env), `apps/web` (jsdom), `packages/shared`.
- API integration harness: globalSetup creates per-worker DB `hub_test_<workerId>`, runs migrations; `beforeEach` truncates (except migrations table); factories create users/projects/trees/grants via services (not raw SQL) to exercise real code.
- Stub AI server: tiny Fastify app on random port returning canned Markdown / 429 / 500 / slow responses by scenario header.

Permission edge-case matrix (must all pass):
| # | Case | Expected |
|---|---|---|
| P1 | No grants anywhere | none → 404 |
| P2 | Grant on project | inherits to deep doc |
| P3 | Project viewer, folder editor | folder subtree editor, siblings viewer |
| P4 | Project editor, folder `none` | folder subtree hidden; child with explicit viewer under restricted folder visible (+ in /me/shared) |
| P5 | Grant on doc only | doc visible, parent 404, appears in /me/shared |
| P6 | Move node from editor folder to viewer folder | inherited role becomes viewer; explicit grants on moved node unchanged |
| P7 | Move into own descendant | 400 cycle rejected |
| P8 | Move across projects | 400 |
| P9 | Delete folder containing child restricted from caller | 403 SUBTREE_RESTRICTED, nothing deleted |
| P10 | Remove last project admin | 409; system admin can |
| P11 | Revoke grant mid-request sequence | subsequent request reflects revoke (no stale cross-request cache) |
| P12 | Disabled user | sessions dead, 401 |
| P13 | System admin | admin everywhere |
| P14 | Randomized ≥500 trees × grants | resolver == CTE oracle; closure == transitive closure |
| P15 | Concurrent moves (parallel) | no deadlock, closure invariant holds |

Template matrix: valid data; missing required; wrong type; additionalProperties; `if/then` conditional; old doc pinned to v1 after v2 published; upgrade valid/invalid; malicious schemas (remote `$ref`, non-object root, >256KB, unknown keyword under strict); client/server verdict parity on fixture set.

Publish matrix: unknown/revoked/expired token → 404; restricted child hidden; creator demoted/disabled → 404; node moved out of subtree → 404; file of non-subtree node → 404; branding color injection rejected; public response contains no emails.

AI matrix: draft success < 30s w/ stub; 429 then success (retry); 500 x3 → failed; permission revoked before run → failed FORBIDDEN, no doc; summarize over budget → truncated markers; non-owner status → 404.

## Related Code Files (create)
- `vitest.workspace.ts`, `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`
- `apps/api/test/`: `global-setup-test-database.ts`, `test-app-factory.ts`, `test-data-factories.ts`, `stub-ai-proxy-server.ts`
- `apps/api/test/integration/`: `permission-edge-cases.test.ts`, `permission-oracle-property.test.ts`, `tree-closure-invariants.test.ts`, `auth-and-sessions.test.ts`, `documents-and-files.test.ts`, `form-documents-validation.test.ts`, `templates-versioning.test.ts`, `public-share-leaks.test.ts`, `ai-jobs.test.ts`, `route-guard-coverage.test.ts`
- `apps/api/src/**/*.test.ts` colocated unit tests
- `apps/web/**/*.test.tsx` component tests; `apps/web/test/frontend-convention-checks.test.ts` (no inline keys, no toast/navigate in mutations)
- `e2e/playwright.config.ts`, `e2e/golden-flow.spec.ts`
- `.github/workflows/ci.yml` (**GitHub Actions, confirmed** — repo hosted on GitHub)
- dev dep: `fast-check` (property tests)

## Implementation Steps
1. Vitest workspace + per-worker test DB global setup + truncate helper.
2. `test-app-factory.ts` (buildApp with test env) + data factories + login helper (cookie).
3. `route-guard-coverage.test.ts`: iterate `app.printRoutes`/route registry; every non-public route has auth + guard metadata.
4. Permission matrix P1-P15 + fast-check oracle property test.
5. Template, publish, AI matrices (stub AI server).
6. Web component tests + convention checks.
7. Playwright golden flow: login as seeded admin → create project → folder → page (type text, autosave) → form doc (fill, save) → grant user viewer on folder → login as user, verify read-only → create share link → open in new context (no cookies) → branded public view shows page + form → revoke → 404.
8. CI (GitHub Actions, `.github/workflows/ci.yml`): services postgres16 + redis7 (`services:` block); steps lint → typecheck → unit → integration → build → e2e; upload coverage; fail under thresholds; trigger on PR + push to `main`.
9. tester agent runs full suite; fix failures (no skipping); code-reviewer pass.

## Todo List
- [ ] Harness (per-worker DB, app factory, factories, stub AI)
- [ ] Route guard coverage test
- [ ] Permission matrix + property oracle
- [ ] Template matrix
- [ ] Publish leak matrix
- [ ] AI matrix
- [ ] Web component + convention tests
- [ ] Playwright golden flow
- [ ] CI pipeline + coverage gates

## Success Criteria
- All matrices green in CI; resolver/service 100% branch; api ≥ 80% lines; golden e2e green 3 consecutive runs (no flake).

## Risk Assessment
- Slow integration suite → per-worker DBs parallelize; truncate not recreate.
- Flaky e2e (autosave timing) → wait on save-status "Saved" indicator, not timeouts.
- Property test non-determinism → fixed seed in CI + print seed on failure.

## Security Considerations
- Test secrets only in CI env; seed passwords test-only; no real proxy key in CI (stub).
- Leak matrices double as security regression suite.

## Next Steps
- After green: code-reviewer agent, docs-manager updates `docs/` (architecture, code standards, changelog, roadmap), project-manager updates plan status.
