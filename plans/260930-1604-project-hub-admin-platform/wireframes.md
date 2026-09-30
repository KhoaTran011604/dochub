# Wireframes — Project Document Hub & Client Publish Platform

Low-fi ASCII wireframes, 5 core screens. Review artifact only, no code.

**v2 (2026-09-30):** restyled per feedback — the top-bar-only (screen 1) vs bare "< Back" (screens 3/4) vs "HUB" crumb (screen 2) navigation was inconsistent and felt cluttered/hard to use. All authenticated screens (1-4) now share one persistent left icon-rail sidebar + breadcrumb, and the visual language is spelled out as a concrete palette instead of descriptive-only. See [Revision Log](#revision-log-2026-09-30-v2) at the bottom. No new features/endpoints introduced — layout + styling only, same data/actions as v1.

**Global shell (screens 1-4):** a slim, always-visible left icon rail (~64px collapsed, labels on hover/expand) replaces the ad-hoc back-button/crumb per screen:

```
+--------+
|  ◆ HUB |  <- logo mark, click = go to Dashboard (screen 1)
|--------|
|  ⊞     |  <- Dashboard (active = gradient pill fill + accent left-bar)
|--------|
|        |
|  (···) |  <- spacer, grows
|        |
|--------|
| (JT) v |  <- avatar, org/account menu, anchored bottom
+--------+
```

- Only one nav item today (Dashboard) — kept intentionally minimal (YAGNI): no invented "Shared/Trash/Settings" global entries, since no such screens/endpoints exist in the plan. Per-project trash stays scoped inside the workspace (screen 2), as before.
- Rail is persistent chrome, not a per-screen widget — same DOM/component on screens 1-4, so navigating between them never re-mounts it (no flash/jump).
- Collapses to icons-only by default (reclaims width for the doc tree on screen 2); expands on hover or a pin toggle to show labels.

---

## 1. Project List / Dashboard

```
+--------+----------------------------------------------------------+
| ◆ HUB  |  [Search projects...]                         (JT) v     |
|--------+----------------------------------------------------------+
|  ⊞ ●   |  Projects (24)          [Grid|List]  [Status: All v] [+New]
|--------|  ----------------------------------------------------------
|        |  +----------------+ +----------------+ +----------------+ |
|        |  |▐[A] Acme Co    | |▐[B] Nova Ltd   | |▐[C] Beta Inc   | |
|        |  | ● Active       | | ● Active       | | ○ Draft        | |
|        |  | 12 docs        | | 5 docs         | | 2 docs         | |
|        |  | Updated 2h ago | | Updated 1d ago | | Updated 5d ago | |
|        |  | J.Tran         | | K.Le           | | You            | |
|        |  +----------------+ +----------------+ +----------------+ |
|  (···) |   ^ rounded-xl card, soft shadow (not flat/bordered);     |
|        |     ▐ = 4px left accent bar in project brand color,       |
|        |     brightens to a 2-stop gradient on hover               |
|--------|                                                            |
| (JT) v |                                                            |
+--------+----------------------------------------------------------+
```

- Card = one `Project`; left accent bar = per-project brand color (reused on public view), swaps to a soft gradient sweep on hover as the hover affordance — no layout-shifting scale transform.
- Status badge: Active / Draft / Archived (`projects.status`, phase-01); doc count = `COUNT` of descendant `document` nodes via closure; Owner = project node's `created_by` — all backed by real fields/queries (phase-02 `GET /projects` response), no new schema beyond `status`. Filter bar + free-text search (live, client-side for <50 items).
- Hover reveals quick actions: Share, Archive (Duplicate dropped — no backing endpoint, YAGNI per sign-off 2026-09-30).
- Click card -> opens Project Workspace (screen 2). "+ New" opens create-project modal (name, client, brand color/logo optional at creation, can set later); primary "+ New" button uses the gradient-fill CTA style (see Visual Design Direction).
- Empty state: illustration + "Create your first project" CTA.

---

## 2. Project Workspace

```
+---+------+--------------------------------------------+------------+
| ◆ | Acme Co / Contracts / MSA Draft       [Trash][Share]|Permissions|
|---+------+--------------------------------------------+------------+
| ⊞ | v Acme Co                [+]                        | "MSA Draft"|
|   |   v 01 Contracts         [+]                        |------------|
|(··)|     - MSA Draft  (page)  ***  <- selected, gradient | Inherited  |
|   |       left-bar + tinted row bg                       | from       |
|   |     - SOW Template (form)                            | "Contracts"|
|   |   v 02 Deliverables      [+]                        |------------|
|   |     - Design Assets                                 | J.Tran Admin|
|   |     - Sprint Report (form)                          | K.Le   Edit |
|   |   > 03 Invoices                                     | Client View |
|(JT)|                                                     | (custom pin)|
|   | [+ Add space/folder/page/form]                       |------------|
|   |                                                      |[+ Override]|
|   |                                                      |[Publish...]|
+---+------------------------------------------------------+------------+
|     MAIN CONTENT AREA                                               |
|     Renders selected node: page editor / form / folder summary,     |
|     or empty state "Select a document from the tree"                |
+-----------------------------------------------------------------------+
```

- Global icon rail (leftmost, from the shared shell) sits *outside* the project tree column — clicking the ◆ logo always returns to the Dashboard; it stays collapsed here by default so the doc tree gets the width. `[Trash]` moves next to the breadcrumb (was a lone header icon) — still opens the same project-scoped slide-over, just relocated for a consistent header row across screens.
- Left tree: Notion-style nested nodes (Space > Folder > Document); icons differ for `page` vs `form`; drag-and-drop to reorder/move; `[+]` per row adds a child; `***` = drag handle on hover; right-click context menu (rename/move/delete/restore-if-trashed). No "duplicate" — dropped, no backing endpoint (sign-off 2026-09-30). Selected node gets a tinted background + 3px gradient left-bar (same accent language as the dashboard card), not just a bold label, so the active doc is visible at a glance in a long tree.
- `[Trash]` icon in header (next to breadcrumb) opens a slide-over panel: flat list of trashed top-level nodes for the project (`GET /projects/:id/trash`), each row = title, type icon, deleted date, `[Restore]` button; empty state "Nothing in trash". System admins additionally see `[Delete permanently]` (typed-confirmation modal) per row.
- Breadcrumb top reflects current tree path; `[Share]` button opens invite modal (email/org-member picker + role).
- Right permission panel toggleable, scoped to the currently-selected node:
  - Rows = user/role grants; "Inherited from X" label when no override exists at this node; badge switches to "Custom" once an override is added.
  - `[+ Override]` breaks inheritance and lets admin set node-specific ACL.
  - `[Publish...]` toggles/creates the public read-only link for this subtree (feeds screen 5).
- Main content area swaps based on node type: BlockNote editor for `page`, rjsf form for `form`.

---

## 3. Document Editor (`page` — BlockNote)

```
+---+--------------------------------------------------------------+
| ◆ | Acme Co / Contracts / MSA Draft    Saved 2m ago    [Share]   |
|---+--------------------------------------------------------------+
| ⊞ | ! Someone else saved changes to this document. [Reload] to   |
|   |   see their version (your unsaved edits will be lost).       | <- 409 conflict banner (on save collision)
|(··)+--------------------------------------------------------------+
|   | # Master Service Agreement                                    |
|   | Type '/' for commands...                                      |
|   |                                                                |
|   | ## 1. Parties                                                 |
|   | This agreement is made between [Client] and [Company]...      |
|   |                                                                |
|   | [ ] Checklist item one                                        |
|   | [x] Checklist item two                                        |
|   |                                                                |
|   | +------------------------------------------------+            |
|   | | [Image placeholder]                             |            |
|   | +------------------------------------------------+            |
|   |                                                                |
|(JT)| > Callout: important clause about termination.               |
|   |                                                                |
|   |        +---------------------------+                          |
|   |        | B  i  H1  H2  Link  Color | <- floating toolbar       |
|   |        +---------------------------+   (appears on text select)|
|   +----------------------------------------------------------------+
|   | [/] slash menu -> Text, Heading, Bullet/Numbered, Checklist,   |
|   |                   Table, Image, Callout, Embed form reference  |
|   +----------------------------------------------------------------+
|   |                                        [✦ Generate with AI]    |
+---+------------------------------------------------------------------+
```

- Global icon rail persists here too — the previous lone "< Back" text link is gone; back-navigation is now: click ◆ for Dashboard, or click any breadcrumb segment (e.g. "Contracts") to return into the tree at that level, same breadcrumb component as screen 2.
- Standard block editor UX: `/` opens block-insert menu; per-block drag handle + `⋮` menu (turn into, duplicate, delete, color) on hover, left of block.
- Selecting text shows floating format toolbar (bold/italic/heading/link/color) — no inline comment thread in MVP (dropped, no backing endpoint; sign-off 2026-09-30).
- Autosave indicator top-right; `[Share]` reuses screen-2 permission panel.
- Viewer role: whole editor renders read-only (no `/` menu, no drag handles, no floating toolbar, no autosave/AI affordances) — same visual treatment as screen 5's public read-only render.
- `[✦ Generate with AI]` opens a prompt panel (e.g. "draft section from template X") that runs as a background job and **creates a new draft page document** (sibling node, title "AI Draft: <title>") for review — it does not insert blocks into the current document. Pending/failed job states shown as a toast + entry in a small "AI jobs" tray.

---

## 4. Dynamic Template Form View (`form` — react-jsonschema-form)

```
+---+--------------------------------------------------------------+
| ◆ | Acme Co / Deliverables / Sprint Report  Draft [Save][Submit] |
|---+--------------------------------------------------------------+
| ⊞ | Project Name *        [ Acme Co                          ]   |
|   | Sprint Number *        [ 12                     ]            |
|(··)| Status *               [ In Progress               v ]       |
|   |                                                                |
|   | -- Team Info (nested object) ------------------------------  |
|   | | Lead *             [ K.Le                          ]     | |
|   | | Members (array)    [ + Add member ]                      | |
|(JT)| |   1. [ J.Tran        ]  [x]                              | |
|   | |   2. [ M.Nguyen      ]  [x]                                | |
|   | ------------------------------------------------------------  |
|   |                                                                |
|   | Budget (number)       [ 12000        ] USD                    |
|   | Notes (textarea)      [                                    ]  |
|   |                       [                                    ]  |
|   |                                                                |
|   | ! Sprint Number must be a positive integer (inline error)     |
+---+--------------------------------------------------------------+
```

- Global icon rail + breadcrumb replace the old "< Back" link, same as screen 3 — one consistent navigation pattern across every authenticated screen instead of three different ones.
- Widgets map 1:1 from JSON-schema types: string->text, number->numeric input, enum->select, object->bordered fieldset (collapsible if deep), array->repeatable row list with add/remove.
- Required fields marked `*`; inline validation on blur + on submit; errors shown under field and summarized at top if submit blocked. `Submit` button uses the gradient-fill CTA style; disabled/muted state (no gradient, gray) while the form has blocking errors.
- `[Save]` = persists draft (editable, `documents.status='draft'`). `[Submit]` = validates + sets `documents.status='submitted'`: fields become read-only, header badge shows "Submitted", editor/admin see a `[Reopen]` button (sets status back to `draft`) in place of Save/Submit; viewers always read-only regardless of status.
- Same permission panel from screen 2 applies to this node (form-level sharing, not per-field).

---

## 5. Public Published Site View (client-facing, no login)

```
+----------------------------------------------------------------+
| [Client Logo]   Acme Co — Project Docs      (theme-color bar)  |
+----------------------------------------------------------------+
| Contents           |  Master Service Agreement                 |
| - Contracts         |------------------------------------------|
|   - MSA Draft       |  # Master Service Agreement               |
|   - SOW Template    |  This agreement is made between...        |
| - Deliverables       |                                           |
|   - Sprint Report   |  ## 1. Parties                            |
|                      |  ...                                      |
|                      |  (read-only render, no toolbars/handles)  |
+----------------------------------------------------------------+
|                 Powered by Project Hub  (small, muted, optional)|
+----------------------------------------------------------------+
```

- Only nodes the shared link grants `viewer`+ on appear in the tree — permission-filtered server-side, not just hidden in UI.
- Branding: client logo replaces company logo top-left; theme color drives accent (links, active nav item, top bar); falls back to default company branding if project has none set.
- `page` docs render BlockNote content read-only (no slash menu, no drag handles, no comments unless explicitly enabled later).
- `form` docs render as a clean label/value summary (not editable inputs) — nested objects as sub-sections, arrays as lists.
- Mobile: sidebar collapses to a hamburger/drawer; single-column reading layout.
- No login wall, no company internal nav/branding, no edit affordances anywhere on this view.
- No comment/"request change" affordance in MVP UI — `comments` table exists as a schema placeholder only (phase-01), reserved per sign-off 2026-09-30; not built or exposed until a future phase explicitly scopes it.

---

## Visual Design Direction (for Phase 7 high-fi implementation)

ASCII layouts above = structure only. Style resolved to a concrete system in v2 (was descriptive-only in v1) — style category **"Soft UI Evolution"** (soft shadows, WCAG AA+, matches modern-SaaS/minimalist ask) via `ui-ux-pro-max`, with an indigo→pink accent gradient for the "trẻ trung năng động" (youthful/energetic) requirement:

- **Style:** modern, minimalist — generous whitespace, clean typography, no clutter/skeuomorphism.
- **Navigation shell:** persistent left icon rail (see Global shell above) — sidebar background uses the accent gradient at low intensity (`#4F46E5` → `#7C3AED`, dark), active item = solid gradient pill; content area stays light (`#F8FAFC`) for reading contrast.
- **Palette (default/light):**
  | Role | Token | Hex |
  |---|---|---|
  | Primary | `--color-primary` | `#6366F1` (indigo-500) |
  | Accent gradient | `--gradient-accent` | `linear-gradient(135deg, #6366F1 0%, #EC4899 100%)` |
  | Background | `--color-bg` | `#F8FAFC` |
  | Surface (cards/panels) | `--color-surface` | `#FFFFFF` |
  | Text | `--color-text` | `#0F172A` |
  | Text muted | `--color-text-muted` | `#475569` |
  | Border | `--color-border` | `#E2E8F0` |
  | Success / Warning / Danger | `--color-success/warning/danger` | `#10B981` / `#F59E0B` / `#EF4444` |
- **Typography:** headings **Manrope** (600/700), body **Inter** (400/500) — geometric-humanist pairing, reads modern/friendly rather than corporate or code-technical.
- **Elevation:** soft drop-shadow on cards/panels/modals — `0 2px 8px rgba(15,23,42,.06), 0 8px 24px rgba(15,23,42,.08)`, 12-16px corner radius; never flat/hard-bordered.
- **Color transitions:** the accent gradient (not flat fills) drives primary CTAs, active-state pills (rail item, selected tree node), the left accent bar on project cards, and status chips — 150-300ms color/opacity transitions on hover, no layout-shifting scale transforms.
- Applies to: dashboard cards, nav rail, permission panel, buttons/CTAs, status badges, public-view theme-color bar (screen 5's per-project branding stays the natural home for a *custom* per-client gradient, overriding the default indigo→pink).
- Accessibility floor carried over from the skill's checklist: 4.5:1 text contrast, visible focus rings, `prefers-reduced-motion` respected, no color-only status indicators (badges keep icon/shape + label, not just hue).
- Action: when Phase 7 (frontend admin app) starts, treat the palette/type table above as the source of truth (Tailwind theme tokens) — do not hardcode colors ad-hoc per component; re-run `ui-ux-pro-max` only if the direction changes.

---

## Review Decisions (sign-off 2026-09-30)

### Product questions
1. **Public link scope**: single project-level publish toggle (whole shared subtree) — confirms plan.md's already-resolved decision, no per-node links/expiry.
2. **Share flow (screen 2 `[Share]`)**: email invite + role only, extended to accept **multiple emails in one invite** (comma/enter-separated email chips, single role applied to all). No org-member picker, no separate external-link flow.
3. **Public view interaction**: reserve room for a future "request change" affordance — `comments` table added to phase-01 as an unwired placeholder (see phase-01). Not built/exposed in MVP.

### API-coverage cross-check (fork agent, 2026-09-30)
- Gaps found and resolved:
  - Dashboard status badge / archive action → `projects.status` column + `PATCH /projects/:id` added (phase-01, phase-02).
  - Dashboard doc count / owner → confirmed derivable from existing `nodes.created_by` + closure count, no schema change, response shape noted in phase-02.
  - Duplicate (project card, tree context menu) → dropped from wireframes (YAGNI, no endpoint).
  - Editor inline comments (`[Comments]` button) → dropped from wireframes (no endpoint; distinct from the public-view placeholder above).
  - Form Save/Submit lock → `documents.status` (draft/submitted) + submit/reopen endpoints added (phase-01, phase-04).
  - Trash/Restore had endpoints but no UI → Trash panel added to screen 2.
  - AI "Generate with AI" wireframe corrected: creates a new draft page document (matches phase-05 job design), not an inline block insert.
  - Editor 409 conflict banner + viewer read-only mode made explicit in screen 3.

### Sign-off
- All 5 screens reviewed against Phases 1-6 endpoints; gaps above resolved in phase-01/02/04.
- Permission panel semantics (inherited/explicit/none, source node) — approved as designed.
- **Status: approved.** Unblocks Phase 7A and UI parts of Phases 3/4/6.

---

## Revision Log (2026-09-30, v2)

**Trigger:** feedback that the layout was inconsistent/hard to use (top-bar-only on screen 1, bare "< Back" link on screens 3/4, "HUB" text crumb on screen 2 — three different navigation patterns for one app) and that the color direction was too vague to look "modern".

**Changes (layout + styling only, no new features/endpoints — API-coverage sign-off above still holds):**
1. Added a persistent left icon-rail navigation shell shared by screens 1-4, replacing the three inconsistent per-screen nav patterns.
2. Replaced "< Back" links (screens 3, 4) with the same breadcrumb pattern already used on screen 2 — consistent way to navigate up, not just back.
3. Resolved "Visual Design Direction" from descriptive-only guidance into a concrete palette/typography table (indigo→pink gradient accent, Soft UI Evolution shadow/elevation system, Manrope/Inter type pairing) so Phase 7 has fixed tokens instead of picking colors ad-hoc.
4. Screen 5 (public view) unchanged structurally (no login, no internal nav is intentional there) — inherits the same accent-gradient/shadow tokens for its theme-color bar.

**Not done / explicitly out of scope:** no new global nav items (Shared/Trash/Settings) were added to the rail — kept to Dashboard only per YAGNI, since no other top-level screen/endpoint exists in the plan. High-fidelity mockups/components are still Phase 7 work; this revision only fixes structure + resolves the palette.
