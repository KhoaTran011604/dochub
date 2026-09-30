# Phase 00 - Wireframes & UI/UX Design Review

## Context Links
- Deliverable: [wireframes.md](wireframes.md) (produced by ui-ux-designer agent)
- [plan.md](plan.md) | [brainstorm](../reports/brainstorm-260930-1604-project-hub-admin-platform.md)

## Overview
- Priority: P1 (gate) | Status: **review** | Effort: 4h
- Stakeholder review of 5 key screens. **Gates all `apps/web` work (Phase 7A, UI parts of 3/4/5/6).** Does NOT block backend Phases 1-5.

## Key Insights
- Screens: (1) project dashboard, (2) project workspace + permission panel, (3) document editor, (4) dynamic template form view, (5) public published site view.
- Permission panel UX is the riskiest screen: must communicate inherited vs explicit vs blocked (`none`) roles clearly.
- Public view branding (logo + theme color) must not leak into admin UI.

## Requirements
- Functional: each screen maps to API endpoints in Phases 1-6; all states covered (empty, loading, error, no-access, 409 conflict on save, AI job pending/failed).
- Non-functional: shadcn/ui + Tailwind vocabulary so wireframes translate 1:1 to components; responsive desktop-first (admin), public view mobile-friendly.

## Architecture
- Screen → route map (confirm during review):
  - `/projects` dashboard (GenericTable)
  - `/projects/:projectId` workspace: left tree sidebar, main pane, right permission drawer
  - `/projects/:projectId/docs/:nodeId` page editor or form view (by doc type)
  - `/admin/templates`, `/admin/users` (system admin; not wireframed — use GenericTable/GenericForm defaults)
  - `/public/:shareToken[/:nodeId]` public layout (separate, no admin chrome)

## Related Code Files
- Create: none (design only). Review notes appended to `wireframes.md` "Review decisions" section.

## Implementation Steps
1. Read `wireframes.md`; verify all 5 screens present with states listed above.
2. Walk each screen against endpoint list (Phases 1-6); flag any UI needing data not in API.
3. Confirm permission panel shows: effective role, source node ("inherited from X"), explicit override control, "restrict (none)" option.
4. Confirm editor: autosave indicator, conflict (409) banner, AI "generate draft" entry point.
5. Confirm template form view: RJSF layout from `ui_schema`, template version shown, validation error display.
6. Confirm public view: logo, theme color, tree nav, read-only page + form rendering.
7. Record decisions + change requests; stakeholder sign-off → set status `approved`.

## Todo List
- [ ] Wireframes delivered for 5 screens
- [ ] API-coverage cross-check done
- [ ] Permission panel semantics approved
- [ ] Editor/form/public states approved
- [ ] Stakeholder sign-off recorded

## Success Criteria
- Written sign-off in `wireframes.md`; no open UI questions blocking Phase 7A.

## Risk Assessment
- Late design churn → frontend rework. Mitigation: backend proceeds independently; frontend starts only post sign-off.
- Scope creep via wireframes (e.g., comments, search). Mitigation: reject anything in plan.md "out of scope".

## Security Considerations
- Ensure UI never exposes share token management to non-admins of the node; public view shows no internal user names/emails.

## Next Steps
- Unblocks Phase 7A (app shell) → UI parts of Phases 3, 4, 6, 5.
