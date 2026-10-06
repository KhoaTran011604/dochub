# Code Review: Tree fallback for per-document shares + collection access (GH-5)

Date: 2026-10-06 · Read-only review of uncommitted changes in `hd-document` (branch `feat/phase-5-6-7`) and `erp-fake`.

## Scope
- hd-document: `packages/outline-api-client/src/{documents-api,groups-api,outline-api-types,index}.ts`, `apps/outline-permission-api/src/document-tree/{load-shared-documents-tree,load-project-document-tree-service}.ts` (+test), `documents/create-node-feature.ts`, `projects/{list-project-members-service,projects-routes}.ts`, `create-permission-api-application.ts`.
- erp-fake: `lib/hd-document-{roles,client}.js`, `app/api/hd/projects/[id]/{sync,collection-members,collection-members/[userId]}/route.js`, `app/components/{hd-collection-access-modal,hd-document-panel}.jsx`.
- Verification: `tsc --noEmit` (permission-api) = 0 errors; `vitest run src/document-tree src/projects` = 29/29 pass. Docker/e2e not run (per instructions).

## Overall
The fallback design is sound: everything is fetched with the user's own token so Outline is the authority; only `id/title/url` leave the service; cross-collection roots are filtered and `parentDocumentId` is re-validated via `documents.info` + `collectionId`. The erp-fake split between node permissions and collection roles is clean. Two real bugs: a runtime `ReferenceError` in erp-fake that breaks every manage-gated route for non-Admin users, and silent truncation / wrong `hasMoreChildren` in the fallback. The fallback can also fan out to ~1000 sequential Outline calls per request.

## Critical

### C1. `permissionsOf` is no longer imported but still used — ReferenceError for every non-Admin user on manage routes
`erp-fake/lib/hd-document-client.js:5` imports only `{ isAdmin, isProjectManager }`; line 111 still calls `permissionsOf(user)`. For any non-Admin caller of a `manage: true` route (sync, create node, node permissions, both new collection-members routes) the function throws before returning, Next.js answers 500. Users with `projects:manage` (non-Admin) therefore cannot use any manage feature; Admins are unaffected because `!admin` short-circuits. Fix: `if (manage && !isProjectManager(user))` and drop the `admin` branch, or re-import `permissionsOf`.

## High

### H1. Fallback truncation is invisible: `truncated` is never set and `hasMoreChildren` becomes `false` for cut nodes
`load-shared-documents-tree.ts:36-40,68-69` trims with its own budget (`maxNodes`), returning at most 1000 nodes. `load-project-document-tree-service.ts:149-150` then runs `mapLevel` with a fresh 1000 budget over that already-trimmed tree, so `budget.truncated` can never flip in the fallback path. Consequences:
- When `expandLevels` returns early (`budget.left <= 0`, line 36) the remaining siblings keep `children: []`, which `mapLevel:78` reports as `hasMoreChildren: false` — the ERP believes those nodes are leaves.
- The look-ahead level (depth+1, fetched only to compute `hasMoreChildren`) is charged against the same budget, so e.g. 400 roots x 2 children exhausts the budget after ~330 roots even at `depth=1`.
- Docs (`erp-integration-api-guide.md:139`) promise `truncated: true` when the cap is hit.
Fix: give `loadSharedDocumentsTree` a `{ left, truncated }` budget shared with `mapLevel` (or return `{ nodes, truncated }`), set `truncated` whenever a slice drops nodes or `expandLevels` bails, and do not charge look-ahead children (set `hasMoreChildren` from `children.length > 0` before slicing). Add a unit test for the fallback with > `MAX_TREE_NODES` nodes.

### H2. Unbounded fan-out: up to ~1000 sequential `documents.list` calls per tree request
`expandLevels` issues one `listChildren` per node at every level including the look-ahead level (`load-shared-documents-tree.ts:37`), each paginated up to 50 pages and retried up to 3x with a 10 s timeout (`outline-http-client.ts:29-30`). Worst case is `MAX_TREE_NODES` sequential round-trips per request, with no overall deadline; a single user with many shared nodes can tie up the Koa worker for minutes and burn Outline's API rate limit (erp-fake aborts at 15 s, `hd-document-client.js:23`, so the user just sees `HD_UNREACHABLE`). Fix options: cap the number of Outline calls per request (e.g. `MAX_FALLBACK_CALLS = 100`, set `truncated` when hit), run sibling `listChildren` with bounded concurrency (`Promise.all` over chunks of ~5), and skip look-ahead for the last level when the budget is low. Pagination loops themselves are bounded (`MAX_PAGES = 50`, `documents-api.ts:11`, `groups-api.ts:39`) — but a >5000-row result is silently cut; log or flag it.

## Medium

### M1. Sync is not convergent: stale collection roles are never removed (erp-fake)
`sync/route.js` + `pushProjectMember` (`hd-document-client.js:55-60`) only ever add `manager`. Members synced as `editor/viewer` by the previous Sync keep that role; a user who loses `projects:manage` keeps `manager`; a user removed from the ERP project keeps whatever role they had. The README says Sync gives only managers a role, which is now true for additions but not for the resulting state. Suggested rule that still respects manual "Collection access" assignments: after pushing, call `GET /projects/{key}/members` and (a) `DELETE` anyone who is no longer an ERP project member / Admin, (b) `DELETE` (or downgrade) anyone holding `manager` who is no longer `isProjectManager`. Report them as `removed` in the sync result.

### M2. `app/api/integration/projects/route.js:25` still publishes `editor/viewer` for every member
The service-key integration endpoint still returns `toOutlineRole(permissionsOf(user))` for all members. Nothing in hd-document consumes it today, but any pull-based sync built on it would re-grant collection roles to every member — the exact behaviour this change removes. Either emit `role: 'manager'` only for `isProjectManager(user)` (others `null`) or remove the role field; `toOutlineRole` then has no callers and can be deleted.

### M3. Fallback: shared node whose ancestor (not parent) is also shared appears twice
`load-shared-documents-tree.ts:63-64` dedupes only direct parents. If `A` and `A/B/C` are both shared directly (`B` only cascaded, so absent from `userMemberships.list`), `C` is listed at root and again under `A -> B`. Not a leak, but duplicate ids break tree UIs keyed by id. Fix: after building, drop roots whose id was reached while expanding another root (track a `seen` set in `expandLevels`), or walk `parentDocumentId` chains via `getDocument` (costly). Related: such roots are returned with `parentDocumentId: null` (`mapLevel:77`) although their real parent is hidden — document that `parentDocumentId` in fallback means "parent within the visible tree".

## Low

- L1. `list-project-members-service.ts:41-45` returns deactivated ERP users (`status` is ignored) and the endpoint lives under `permissions:write` although it is read-only. Consider adding `status` to `ProjectMemberView` and/or accepting `tree:read` as well.
- L2. `collection-members/[userId]/route.js:28` — `body.role` throws `TypeError` when the JSON body is `null`/non-object (same pattern as existing node-permission route). Guard with `body?.role`.
- L3. `DELETE collection-members/[userId]` on a member who was never pushed to hd-document relays `404 USER_NOT_IN_OUTLINE`; the modal shows it as an error although "No access" is already the state. Treat that code as success in the route, or `pushUser` first like `PUT` does.
- L4. Children order in the fallback follows `documents.list` default (`updatedAt desc`), not the collection's navigation index, so the same subtree is ordered differently depending on which path served it. `sort: "index"` only works with `collectionId`; alternatively sort by `title` for determinism and document it.
- L5. A non-Admin `projects:manage` user can set an Admin's collection role to viewer/none (Admins are in `loadProjectMembers` for every project). Sync re-adds them; acceptable for a demo, but worth a UI guard (`isManager` rows read-only for non-Admins).
- L6. `listUserMembershipDocuments` breaks on `documents.length < PAGE_SIZE`; Outline builds `documents` from memberships and may drop entries whose document is deleted/unreadable, which would end pagination one page early. Use `pagination`/`memberships.length` if available for the stop condition.

## Answers to the specific questions

1. Info leak in fallback — none found. Roots come from the user's own memberships filtered by `collectionId` (`load-shared-documents-tree.ts:61`); `parentDocumentId` goes through `documents.info` with the user token and a `collectionId` check (lines 55-58); 403/404 from Outline collapse to the same `PARENT_DOCUMENT_NOT_FOUND` as the primary path; zero shares still yields `ACTING_USER_FORBIDDEN`. Only `id/title/url` are copied. Residual item to verify against Outline 1.10.1 source (`server/routes/api/documents/documents.ts`, `documents.list` membership escape): confirm that children returned for a `parentDocumentId` the user holds a membership on are filtered per child (cascaded `sourceId` memberships) and that a document moved under a shared parent receives the cascade — otherwise a moved child could surface. Children are not re-checked for `collectionId` in `expandLevels`; safe as long as Outline keeps subtrees within one collection.
2. Unbounded calls — pagination loops are bounded (50 pages x 100), but per-node fan-out is not; see H2.
3. Budget/truncation — broken in the fallback; see H1. Primary path unchanged and correct.
4. erp-fake auto role paths — `pushProjectMember` and `hdRequestAsMember` are gated by `isProjectManager`; no new automatic grant. Remaining gaps: stale roles from earlier Syncs are never removed (M1) and the integration endpoint still advertises `editor/viewer` for everyone (M2).
5. Auth on new erp-fake routes — both use `authorizeProject(..., { manage: true })`, resolve the target through `loadProjectMembers` (project member or Admin only) and require `idpSub`; the role whitelist is enforced. But C1 currently makes these routes 500 for every non-Admin caller.

## Positive observations
- Fallback reuses `mapLevel`/`OutlineNavigationNode`, so output shape and field whitelist are identical across paths.
- `getDocument` collapses 403/404 to `undefined` in the adapter (`create-node-feature.ts:116-121`), keeping the service free of Outline error types.
- `listGroupMemberUserIds` + "highest role wins" ordering handles the crash-between-groups case documented in `set-project-member-role-service.ts`.
- Audit details added to all three project-member routes without logging titles/tokens.
- erp-fake keeps the service key server-side and the modal degrades correctly for members without IdP login.

## Recommended actions (priority order)
1. Fix C1 (`hd-document-client.js:111`) — one-line change, blocks every manage route for non-Admins.
2. Fix H1: shared budget + `truncated` in the fallback; add a unit test with > 1000 shared nodes.
3. Fix H2: cap Outline calls per request / bounded concurrency.
4. Decide Sync convergence (M1) and update the integration endpoint (M2).
5. M3/L-items as time allows.

## Metrics
- Typecheck: pass (permission-api).
- Tests: 29/29 in `src/document-tree`, `src/projects`; no test yet for fallback truncation or for `load-shared-documents-tree.ts` in isolation.
- Lint: not run.

## Unresolved questions
- Does Outline 1.10.1 `documents.list { parentDocumentId }` filter children by the caller's (cascaded) membership, or return all children once the parent membership exists? Determines whether moved-in children can leak.
- Should Sync remove stale collection roles (M1), given that the new modal allows manual assignments that Sync must not undo?
- Is `GET /api/integration/projects` still consumed by anything? If not, delete it together with `toOutlineRole`.
