# Phase 07 - Frontend Admin App

## Context Links
- [plan.md](plan.md) | [phase-00 wireframes gate](phase-00-wireframes-and-uiux-review.md) | [wireframes](wireframes.md) | `.claude/rules/development-rules.md` (Frontend Rules)
- APIs: [phase-01](phase-01-foundation-data-model-and-auth.md), [phase-02](phase-02-permission-engine.md)

## Overview
- Priority: P1 | Status: pending | Effort: 34h (7A shell 12h, 7B screens 22h)
- **Gate: Phase 0 approved.** 7A = app shell + infra (unblocks UI parts of Phases 3/4/5/6). 7B = management screens (dashboard, workspace tree, permission panel, admin users).

## Key Insights
- Mandatory conventions: all keys in `apps/web/queries/keys.ts`; `queries/{domain}/{queries,mutations}.ts`; GenericForm/GenericTable only; mutation hooks = cache invalidation only, UI feedback via caller callbacks; generic-typed hooks.
- **GenericForm = RJSF wrapper** (`@rjsf/core` v6 + `@rjsf/shadcn` + `@rjsf/validator-ajv8` w/ shared ajv options) → static forms use TypeBox schemas from `packages/shared` (same schema api validates) and dynamic templates use JSONB schema → one form engine, DRY.
- GenericTable = TanStack Table + shadcn table (sorting, client pagination; server pagination later if needed).
- Response types from shared `Static<typeof Schema>` → no hand-written DTO duplication.
- Tree move via "Move to…" dialog (KISS); drag-drop deferred.

## Requirements
- 7A: Vite+React+TS, Tailwind+shadcn/ui, React Router 7 (lazy routes), `api-client` (fetch, `credentials:'include'`, JSON, normalized `ApiError{status,code,message,details}`), QueryClient (retry off for 4xx), auth guard + login page, app layout (topbar, sidebar), GenericForm, GenericTable, toast (sonner), confirm dialog.
- 7B screens: projects dashboard (+ create project for sys admin, "Shared with me"), project workspace (tree sidebar w/ create folder/page/form, rename, move, delete; main pane routes to doc page), permission drawer (explicit + inherited list, add user via search, change role incl. "Restrict (none)", remove; source-node label), admin users page (list, create, disable, reset password), project settings (general + branding form from Phase 6).
- States: loading skeletons, empty, error w/ retry, 404/no-access page, role-based hiding (UI hint only; API enforces).

## Architecture
```
apps/web/
  main.tsx, app-router.tsx
  lib/api-client.ts, lib/query-client.ts
  queries/keys.ts
  queries/{auth,projects,nodes,permissions,users,documents,templates,ai,sharing,public}/{queries,mutations}.ts
  components/ui/{generic-form,generic-table,confirm-dialog}.tsx (+ shadcn primitives)
  components/{layout,projects,tree,permissions,users,...}/
  pages/{login-page,projects-dashboard-page,project-workspace-page,document-page,not-found-page}.tsx, pages/admin/*, pages/public/*
```
`keys.ts` (single object, hierarchical for prefix invalidation):
```ts
export const queryKeys = {
  auth: { me: () => ['auth','me'] as const },
  projects: { all: () => ['projects'] as const, detail: (id: string) => ['projects', id] as const, tree: (id: string) => ['projects', id, 'tree'] as const },
  nodes: { permissions: (id: string) => ['nodes', id, 'permissions'] as const, shareLinks: (id: string) => ['nodes', id, 'share-links'] as const },
  documents: { detail: (id: string) => ['documents', id] as const },
  templates: { list: (projectType?: string) => ['templates', { projectType }] as const, detail: (id: string) => ['templates', id] as const },
  users: { search: (q: string) => ['users','search', q] as const, adminList: () => ['users','admin'] as const },
  ai: { job: (id: string) => ['ai','jobs', id] as const },
  public: { site: (t: string) => ['public', t] as const, document: (t: string, id: string) => ['public', t, id] as const },
  me: { shared: () => ['me','shared'] as const },
};
```
Mutation pattern: `useMoveNode<TData = MoveNodeResponse>(projectId, options?: UseMutationOptions<...>)` → `onSuccess` invalidates `projects.tree(projectId)` then calls `options.onSuccess`. Permission mutations invalidate `nodes.permissions(id)` + `projects.tree(projectId)` (effective roles change).

## Related Code Files (create)
- 7A: `apps/web/{package.json,vite.config.ts,tsconfig.json,index.html,tailwind/postcss config,components.json}`, `main.tsx`, `app-router.tsx`, `lib/api-client.ts`, `lib/query-client.ts`, `queries/keys.ts`, `queries/auth/{queries,mutations}.ts`, `components/ui/generic-form.tsx`, `components/ui/generic-table.tsx`, `components/ui/confirm-dialog.tsx`, `components/layout/{app-layout,auth-guard,topbar}.tsx`, `pages/login-page.tsx`, `pages/not-found-page.tsx`
- 7B: `queries/{projects,nodes,permissions,users}/{queries,mutations}.ts`, `pages/projects-dashboard-page.tsx`, `pages/project-workspace-page.tsx`, `pages/project-settings-page.tsx`, `pages/admin/users-admin-page.tsx`, `components/tree/{project-tree-sidebar,tree-node-item,tree-node-actions-menu,move-node-dialog,create-node-dialog}.tsx`, `components/permissions/{permission-drawer,permission-grant-row,user-search-combobox}.tsx`, `components/projects/{create-project-dialog,shared-with-me-list}.tsx`
- Tree helper: `lib/build-tree-from-flat-nodes.ts` (flat visible list → nested; orphans (parent not visible) become roots)

## Implementation Steps
7A
1. Scaffold Vite React TS; Tailwind + shadcn init; add primitives (button, input, dialog, drawer/sheet, dropdown, table, skeleton, sonner, command).
2. `api-client.ts` + `query-client.ts` (staleTime 30s; no retry on 4xx; 401 → redirect to login handled in a root error boundary/listener, not in hooks).
3. `keys.ts` as above (extend per phase).
4. `generic-form.tsx`: props `{schema, uiSchema?, formData?, onSubmit, readOnly?, extraErrors?, submitLabel?, children?}` generic `<T>`; RJSF shadcn theme; `customizeValidator(ajvOptions)` from shared.
5. `generic-table.tsx`: props `{columns: ColumnDef<T>[], data: T[], isLoading, emptyText, onRowClick?}`; sorting + pagination.
6. Auth: `useMe`, `useLogin`, `useLogout`; login page (GenericForm w/ shared login schema); `auth-guard` + layout; router w/ lazy routes.
7B
7. Projects: dashboard GenericTable (title, type, updated), create dialog (sys admin), shared-with-me list.
8. Workspace: `useProjectTree` → `build-tree-from-flat-nodes` → sidebar (expand state in localStorage); actions menu by effectiveRole; create folder/page/form (form → template picker from Phase 4), rename inline, move dialog (target = folders with editor role; warn "permissions may change"), delete confirm (handles `SUBTREE_RESTRICTED` error message).
9. Permission drawer: explicit grants table + inherited list ("from <node>"), user-search combobox (debounced 300ms), role select incl. Restrict; last-admin error surfaced via callback toast.
10. Admin users page: GenericTable + create/reset/disable dialogs (GenericForm).
11. Project settings: general form + mount Phase 6 branding form + share links entry.
12. Compile (`tsc --noEmit`) + lint; manual run through wireframe screens.

## Todo List
- [ ] 7A scaffold + shadcn + router
- [ ] api-client + query-client + keys.ts
- [ ] GenericForm (RJSF) + GenericTable
- [ ] Auth pages/guard/layout
- [ ] 7B dashboard + shared-with-me
- [ ] Workspace tree sidebar + node actions (create/rename/move/delete)
- [ ] Permission drawer
- [ ] Admin users page
- [ ] Project settings page
- [ ] Compile/lint clean; wireframe parity check

## Success Criteria
- No inline query keys (grep `queryKey: \[` outside keys.ts = 0); no toast/navigate inside `queries/**/mutations.ts` (grep check).
- All screens match approved wireframes; full flow operable w/o curl.

## Risk Assessment
- RJSF shadcn theme gaps → fallback `@rjsf/core` default theme styled via Tailwind; isolate in generic-form only.
- Large trees render slow → flat list + memoized build; virtualize only if >2k visible nodes.
- Stale effective roles after grant change → invalidation map above; test it.

## Security Considerations
- UI role checks are cosmetic; never rely on them. No tokens in localStorage (cookie session). React escaping only; no `dangerouslySetInnerHTML`.
- Public client never sends credentials.

## Next Steps
- UI parts of Phases 3/4/5/6 plug into this shell; Phase 8 e2e runs on it.
