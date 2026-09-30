# Phase 02 - Permission Engine

## Context Links
- [plan.md](plan.md) | [phase-01](phase-01-foundation-data-model-and-auth.md) | [research-01 Topic 2](research/researcher-01-editor-and-permission-engine.md)

## Overview
- Priority: P1 (highest-risk core) | Status: pending | Effort: 22h
- Node-based ACL resolver (nearest explicit grant wins, walking up tree), per-request cache + invalidation, route guards, grant management API, guarded project/folder/tree routes.

## Key Insights
- Walk-up-to-nearest-grant = closure join ordered by depth (`LIMIT 1`); semantically identical to recursive-CTE walk-up on `parent_id` but no recursion per request. Recursive CTE kept as **test oracle** (+ fallback) to prove equivalence.
- Explicit `none` grant = restrict: blocks inherited access for that subtree (Notion "remove access").
- Access to child w/o parent is legal (shared deep link) → need "Shared with me" entry point.
- Subtree ops (delete) can hit nodes caller can't see → must check whole subtree.
- 404 (not 403) when caller has no view access → no existence leak.
- Trashed node (`deleted_at` set) behaves as invisible to every guard/resolver/listVisibleTree except the dedicated trash endpoints — same 404 pattern as no-access, so a trashed id never leaks via error messages.

## Requirements
- Functional:
  - `resolve(user,node)`, `resolveMany(user,nodeIds)`, `listVisibleTree(user,projectId)`.
  - Capabilities: viewer=read; editor=create/edit/move children + content; admin=grants, share links, branding, delete; system admin=everything + create projects/templates/users.
  - Grant CRUD on node (admin on node); last explicit admin on project node cannot be removed/downgraded.
  - Project create (system admin) → tx: project node + projects row + admin grant for creator.
  - Delete (soft) requires ≥editor on every node in subtree; restore requires ≥editor on the node (and parent must not be trashed); permanentDelete = system admin only; move requires editor on node + source parent + target parent, same project, no cycle.
  - Trash listing: `GET /projects/:id/trash` (≥editor on project) → trashed top-level nodes (deleted_at set, parent either not trashed or not in this trashed set) for that project.
  - Permission panel data: explicit grants on node + inherited effective roles with source node.
- Non-functional: resolve p95 < 5ms @ 10k nodes; tree listing single query.

## Architecture
Resolver SQL:
```sql
-- single node
SELECT p.role FROM node_closure c
JOIN node_permissions p ON p.node_id = c.ancestor_id AND p.user_id = $user
WHERE c.descendant_id = $node ORDER BY c.depth LIMIT 1;
-- batch
SELECT DISTINCT ON (c.descendant_id) c.descendant_id, p.role
FROM node_closure c JOIN node_permissions p ON p.node_id=c.ancestor_id AND p.user_id=$user
WHERE c.descendant_id = ANY($nodes) ORDER BY c.descendant_id, c.depth;
```
No row ⇒ `none`. System admin short-circuits to `admin`.

Cache: `request.permCache: Map<nodeId, Role>` (per request, per user). `resolveMany` fills it; guards read it. Cleared on any grant/tree mutation within request (tree-repository `onTreeMutated` hook + grant service). No cross-request cache in MVP (YAGNI); resolver is the single seam to add Redis later if metrics demand.

Guard: `requireNodeRole(minRole, (req)=>nodeId)` preHandler → 404 if `none`, 403 if below min.

API (all `/api`):
| Method | Path | Min role |
|---|---|---|
| POST | /projects | system admin |
| GET | /projects | visible projects (≥viewer on project node); each row includes `status`, `docCount` (COUNT descendant document-type nodes via closure), `ownerName` (project node's `created_by` joined to users) — dashboard card fields |
| GET/PATCH | /projects/:id | viewer / admin; PATCH accepts `status` transitions (active/draft/archived) — dashboard "Archive" action reuses this, no separate endpoint |
| GET | /projects/:id/tree | returns visible nodes `{id,parentId,type,title,position,effectiveRole}` |
| POST | /nodes (folder) | editor on parent |
| PATCH | /nodes/:id (rename/reorder) | editor |
| POST | /nodes/:id/move | editor on node+src+dst |
| DELETE | /nodes/:id | editor on whole subtree (soft-delete) |
| POST | /nodes/:id/restore | editor on node, parent not trashed |
| DELETE | /nodes/:id/permanent | system admin |
| GET | /projects/:id/trash | editor on project |
| GET | /nodes/:id/permissions | admin |
| PUT/DELETE | /nodes/:id/permissions/:userId | admin |
| GET | /me/shared | top-most visible nodes whose parent not visible |

## Related Code Files (create)
- `apps/api/src/modules/permissions/`: `permission-resolver.ts`, `permission-repository.ts`, `permission-service.ts` (last-admin, capability rules), `permission-guard.ts`, `permission-routes.ts`, `permission-recursive-cte-oracle.ts` (test/fallback)
- `apps/api/src/modules/projects/`: `projects-repository.ts`, `projects-service.ts`, `projects-routes.ts`
- `apps/api/src/modules/nodes/`: `nodes-service.ts`, `nodes-routes.ts`
- `packages/shared/src/schemas/`: `project-schemas.ts`, `node-schemas.ts`, `permission-schemas.ts`
- Modify: `apps/api/src/app.ts` (register modules), `plugins/session-auth-plugin.ts` (init `permCache`)

## Implementation Steps
1. `permission-resolver.ts`: `resolve`, `resolveMany`, `listVisibleTree` (nodes of project LEFT JOIN LATERAL nearest grant; filter ≥viewer), all via per-request cache.
2. `permission-recursive-cte-oracle.ts`: same semantics via `WITH RECURSIVE` on `parent_id` (depth guard 1000). Used in property tests; not wired in routes.
3. `permission-guard.ts` preHandler factory; 404/403 semantics; role compare via `roleRank` from shared.
4. `permission-repository.ts`: upsert/delete grant; list explicit grants on node; list inherited (for each user having grants on ancestors: nearest grant + source node id/title).
5. `permission-service.ts`: validate target user active; forbid role > admin; last-admin rule on project node (tx + `FOR UPDATE` on grants of node); clear cache.
6. Projects module: create (tx: tree-repository.create project + projects row + admin grant), list visible (with `docCount`/`ownerName`/`status` aggregates), get, patch (title/description/status).
7. Nodes module: folder create, rename/reorder (position), move (guards + tree-repository.move), delete (resolveMany over subtree ids from `path LIKE`; all ≥editor else 403 `SUBTREE_RESTRICTED`; soft via tree-repository.deleteNode), restore (guard + tree-repository.restoreNode, 409 if parent trashed), permanentDelete (system-admin guard + tree-repository.permanentDeleteNode), project trash listing.
8. `/me/shared`: visible nodes where parent is null-visible (compute from `listVisibleTree` per project with grants for user; query distinct projects from user's grants).
9. Wire `onTreeMutated` → clear `request.permCache`.
10. Unit+integration tests (see Phase 8 matrix) incl. oracle equivalence on randomized trees/grants.
11. `pnpm -r build` compile check.

## Todo List
- [ ] Resolver (single, batch, tree) + cache
- [ ] Recursive CTE oracle
- [ ] Guard preHandler (404/403)
- [ ] Grant repository + service (last-admin rule)
- [ ] Projects module
- [ ] Nodes module (create/rename/move/delete/restore/permanent-delete/trash-list)
- [ ] /me/shared
- [ ] Tests incl. randomized oracle equivalence
- [ ] Perf check 10k nodes

## Success Criteria
- Randomized test (≥500 trees × random grants incl. `none`): closure resolver == CTE oracle for every (user,node).
- All edge cases in Phase 8 matrix pass; p95 resolve < 5ms on 10k-node seed.

## Risk Assessment
- Access leak after move (inherited role changes) → by design (inheritance follows new parent); UI confirm dialog warns; tests assert new effective roles.
- Race: grant change mid-request → per-request cache only, short-lived; mutations run in tx.
- Deep trees → depth unlimited but closure rows O(n·depth); fine at target scale; monitor.
- Admin lockout → last-admin rule + system admin override.

## Security Considerations
- Every node-scoped route MUST use guard; code review checklist item + test that iterates all registered routes and asserts guard/public flag present.
- IDs are UUIDs (non-enumerable); 404 on no-view.
- Grant endpoints never reveal users outside search results beyond id/name/email.

## Next Steps
- Phases 3, 4, 6 reuse `requireNodeRole` + `resolveMany`; Phase 6 reuses closure for share-subtree membership check.
