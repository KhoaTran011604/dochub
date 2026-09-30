# Phase 06 - Public Publish (Share Link + Branding)

## Context Links
- [plan.md](plan.md) | [phase-02](phase-02-permission-engine.md) | [phase-03](phase-03-document-editor-blocknote.md) (viewer) | [phase-04](phase-04-dynamic-template-system.md) (readOnly form) | [research-01 pitfalls #3](research/researcher-01-editor-and-permission-engine.md) | [wireframes: public view](wireframes.md)

## Overview
- Priority: P1 | Status: pending | Effort: 18h
- Node admins create share links for any node (project/folder/doc). Anonymous `/public/:shareToken` renders that subtree read-only with project branding (logo + theme color). Revocable, optional expiry.

## Key Insights
- **Share = delegated view of creator**: public-visible nodes = share-root subtree ∩ nodes creator can currently view ∩ **not trashed** (`deleted_at IS NULL`). Evaluated at every public read → restricted (`none`) children never leak; creator losing admin on share root / being disabled / node being soft-deleted all kill visibility instantly, no separate unpublish step needed. Addresses "link sharing leak" pitfall.
- Subtree membership check = one closure lookup `(ancestor=shareRoot, descendant=nodeId)`.
- Reuse `document-viewer.tsx` + `form-document-view readOnly` → zero new renderers.
- Branding applies only inside `public-site-layout` via CSS variables; admin UI untouched.
- Token stored as sha256 hash → raw link shown only at creation; lost → regenerate (revoke + new).

## Requirements
- Functional:
  - Admin on node: create link (`expiresAt?`), list links on node (created_by, created_at, expires, revoked), revoke.
  - Project admin: set branding (`themeColor` hex, logo upload png/jpg/webp ≤1MB).
  - Public: tree nav, page docs (read-only BlockNote), form docs (read-only RJSF), images/files within subtree, branded header; 404 page for invalid/revoked/expired.
- Non-functional: public endpoints rate-limited (60/min/ip); `X-Robots-Tag: noindex`; no auth cookies sent/required; public bundle lazy-loaded, no editor code.

## Architecture
```
GET /api/public/:token                 → {branding{projectTitle,logoUrl,themeColor}, rootNodeId, tree[{id,parentId,type,title,position}]}
GET /api/public/:token/documents/:id   → page {content} | form {schema, uiSchema, data}
GET /api/public/:token/files/:fileId   → stream (file.node_id must be public-visible)
GET /api/public/:token/logo            → project logo
resolveShare(token): sha256 → share_links row (not revoked/expired) → creator active → creator role(shareRoot) ≥ admin → visibleSet = listVisibleTree(creator) ∩ subtree(shareRoot)
```
Admin API:
| Method | Path | Role |
|---|---|---|
| POST | /nodes/:id/share-links | admin |
| GET | /nodes/:id/share-links | admin |
| DELETE | /share-links/:id | admin on its node |
| PATCH | /projects/:id/branding | admin on project |
| POST | /projects/:id/logo | admin on project |

Frontend route `/public/:shareToken/:nodeId?` → `public-site-layout.tsx` sets `--brand` / `--brand-foreground` (computed contrast) on wrapper; sidebar tree; content pane switches viewer by type. Uses a credential-less fetch client.

## Related Code Files (create)
- `apps/api/src/modules/sharing/`: `share-links-repository.ts`, `share-links-service.ts` (create/revoke/resolveShare), `share-links-routes.ts`, `public-routes.ts`, `share-token-util.ts`
- `apps/api/src/modules/projects/project-branding-service.ts`, routes added to `projects-routes.ts`
- Modify `apps/api/src/modules/files/files-service.ts` (public access path)
- `packages/shared/src/schemas/share-link-schemas.ts`, `public-schemas.ts`, `branding-schemas.ts`
- `apps/web/queries/public/queries.ts`, `apps/web/queries/sharing/queries.ts`, `apps/web/queries/sharing/mutations.ts`, `apps/web/queries/projects/mutations.ts` (branding)
- `apps/web/lib/public-api-client.ts`
- `apps/web/pages/public/public-site-page.tsx`, `apps/web/components/public/public-site-layout.tsx`, `public-tree-nav.tsx`, `public-not-found.tsx`
- `apps/web/components/sharing/share-links-dialog.tsx`, `apps/web/components/projects/project-branding-form.tsx`
- `apps/web/lib/theme-color-contrast.ts`

## Implementation Steps
1. `share-token-util.ts`: 32 random bytes base64url; sha256 hex; timing-safe compare n/a (lookup by hash).
2. Share service: create (admin guard), list, revoke (sets revoked_at), `resolveShare` per above; returns `{shareRootId, projectId, visibleIds:Set}`.
3. Public routes (no session plugin): tree, document, files, logo; every node/file request checks `visibleIds.has(id)`; 404 uniformly for any failure; rate limit + noindex + `Cache-Control: no-store`.
4. Branding: theme color regex `^#[0-9a-fA-F]{6}$`; logo via files module (mime whitelist, 1MB); store `projects.logo_file_id`.
5. Integration tests: revoked/expired/unknown token → 404; restricted child hidden; creator demoted → link dead; file outside subtree → 404; node moved out of subtree → not accessible; **node soft-deleted (trashed) → disappears from public tree immediately, restoring it brings it back with no relink needed**.
6. Web public: route + layout + tree nav + viewer switch (reuse Phase 3/4 components, lazy chunk), branding CSS vars with contrast-computed foreground; not-found page.
7. Web admin: share-links dialog (create → show copyable link once, list, revoke w/ confirm callback), branding form (GenericForm + logo upload + live color preview).
8. Compile + lint; bundle check that public chunk excludes editor.

## Todo List
- [ ] Token util + share repo/service
- [ ] resolveShare (delegated creator view)
- [ ] Public routes (tree/doc/files/logo) + rate limit + noindex
- [ ] Branding endpoints + logo upload
- [ ] Integration tests (leak cases)
- [ ] Web public site (layout, nav, viewers, 404)
- [ ] Web share dialog + branding form

## Success Criteria
- Anonymous browser opens link → branded tree, pages + forms render read-only, images load.
- All leak tests pass (restricted child, revoked, expired, moved-out node, foreign file id).

## Risk Assessment
- Delegated-view surprises (content disappears when creator loses access) → shown in share dialog: "link reflects your access"; admins can recreate.
- Hash-only token → can't re-copy; acceptable (regenerate). Revisit if UX complaint (see plan.md Q10).
- Scraping/enumeration → 256-bit tokens + rate limit.

## Security Considerations
- No session cookie read on public routes; CORS not needed (same origin).
- Uniform 404 (no oracle for token validity vs node existence).
- Theme color strictly validated (CSS injection); logo served nosniff, no SVG.
- Public payload excludes user emails/names, grants, internal ids beyond node ids.

## Next Steps
- Post-MVP: custom domain, per-node exclude flag, view analytics.
