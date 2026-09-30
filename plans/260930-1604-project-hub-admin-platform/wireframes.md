# Wireframes — Project Document Hub & Client Publish Platform

Low-fi ASCII wireframes, 5 core screens. Review artifact only, no code.

---

## 1. Project List / Dashboard

```
+----------------------------------------------------------------+
| [Logo] Project Hub          [Search projects...]   [Avatar v]  |
+----------------------------------------------------------------+
| Projects (24)         [Grid|List]  [Status: All v]  [+ New]    |
+----------------------------------------------------------------+
| +----------------+ +----------------+ +----------------+       |
| | [A] Acme Co    | | [B] Nova Ltd   | | [C] Beta Inc   |       |
| | ● Active       | | ● Active       | | ○ Draft        |       |
| | 12 docs        | | 5 docs         | | 2 docs         |       |
| | Updated 2h ago | | Updated 1d ago | | Updated 5d ago |       |
| | Owner: J.Tran  | | Owner: K.Le    | | Owner: You     |       |
| +----------------+ +----------------+ +----------------+       |
+----------------------------------------------------------------+
```

- Card = one `Project`; color chip = per-project brand color (reused on public view).
- Status badge: Active / Draft / Archived; filter bar + free-text search (live, client-side for <50 items).
- Hover reveals quick actions: Share, Archive, Duplicate.
- Click card -> opens Project Workspace (screen 2). "+ New" opens create-project modal (name, client, brand color/logo optional at creation, can set later).
- Empty state: illustration + "Create your first project" CTA.

---

## 2. Project Workspace

```
+------+--------------------------------------------+------------+
| HUB  | Acme Co / Contracts / MSA Draft      [Share]| Permissions|
+------+--------------------------------------------+------------+
| v Acme Co                [+]                        | "MSA Draft"|
|   v 01 Contracts         [+]                        |------------|
|     - MSA Draft  (page)  ***                        | Inherited  |
|     - SOW Template (form)                           | from       |
|   v 02 Deliverables      [+]                        | "Contracts"|
|     - Design Assets                                 |------------|
|     - Sprint Report (form)                          | J.Tran Admin|
|   > 03 Invoices                                     | K.Le   Edit |
|                                                      | Client View |
| [+ Add space/folder/page/form]                      | (custom pin)|
|                                                      |------------|
|                                                      |[+ Override]|
|                                                      |[Publish...]|
+------------------------------------------------------+------------+
|  MAIN CONTENT AREA                                                |
|  Renders selected node: page editor / form / folder summary,      |
|  or empty state "Select a document from the tree"                 |
+---------------------------------------------------------------------+
```

- Left tree: Notion-style nested nodes (Space > Folder > Document); icons differ for `page` vs `form`; drag-and-drop to reorder/move; `[+]` per row adds a child; `***` = drag handle on hover; right-click context menu (rename/duplicate/move/delete).
- Breadcrumb top reflects current tree path; `[Share]` button opens invite modal (email/org-member picker + role).
- Right permission panel toggleable, scoped to the currently-selected node:
  - Rows = user/role grants; "Inherited from X" label when no override exists at this node; badge switches to "Custom" once an override is added.
  - `[+ Override]` breaks inheritance and lets admin set node-specific ACL.
  - `[Publish...]` toggles/creates the public read-only link for this subtree (feeds screen 5).
- Main content area swaps based on node type: BlockNote editor for `page`, rjsf form for `form`.

---

## 3. Document Editor (`page` — BlockNote)

```
+----------------------------------------------------------------+
| < Back   MSA Draft            Saved 2m ago  [Comments][Share]  |
+----------------------------------------------------------------+
| # Master Service Agreement                                     |
| Type '/' for commands...                                       |
|                                                                  |
| ## 1. Parties                                                  |
| This agreement is made between [Client] and [Company]...       |
|                                                                  |
| [ ] Checklist item one                                          |
| [x] Checklist item two                                          |
|                                                                  |
| +------------------------------------------------+              |
| | [Image placeholder]                             |              |
| +------------------------------------------------+              |
|                                                                  |
| > Callout: important clause about termination.                 |
|                                                                  |
|        +---------------------------+                            |
|        | B  i  H1  H2  Link  Color | <- floating toolbar        |
|        +---------------------------+   (appears on text select) |
+----------------------------------------------------------------+
| [/] slash menu -> Text, Heading, Bullet/Numbered, Checklist,    |
|                   Table, Image, Callout, Embed form reference   |
+----------------------------------------------------------------+
|                                         [✦ Generate with AI]    |
+----------------------------------------------------------------+
```

- Standard block editor UX: `/` opens block-insert menu; per-block drag handle + `⋮` menu (turn into, duplicate, delete, color) on hover, left of block.
- Selecting text shows floating format toolbar (bold/italic/heading/link/color/comment).
- Autosave indicator top-right; `[Comments]` opens inline comment thread; `[Share]` reuses screen-2 permission panel.
- `[✦ Generate with AI]` opens a prompt panel (e.g. "draft section from template X") that inserts generated blocks at cursor — user reviews/edits before it's saved as real content.

---

## 4. Dynamic Template Form View (`form` — react-jsonschema-form)

```
+----------------------------------------------------------------+
| < Back   Sprint Report Form        Draft    [Save] [Submit]    |
+----------------------------------------------------------------+
| Project Name *        [ Acme Co                          ]     |
| Sprint Number *        [ 12                     ]              |
| Status *               [ In Progress               v ]         |
|                                                                  |
| -- Team Info (nested object) ------------------------------    |
| | Lead *             [ K.Le                          ]     |    |
| | Members (array)    [ + Add member ]                       |   |
| |   1. [ J.Tran        ]  [x]                                |   |
| |   2. [ M.Nguyen      ]  [x]                                |   |
| --------------------------------------------------------------  |
|                                                                  |
| Budget (number)       [ 12000        ] USD                      |
| Notes (textarea)      [                                    ]    |
|                       [                                    ]    |
|                                                                  |
| ! Sprint Number must be a positive integer (inline error)       |
+----------------------------------------------------------------+
```

- Widgets map 1:1 from JSON-schema types: string->text, number->numeric input, enum->select, object->bordered fieldset (collapsible if deep), array->repeatable row list with add/remove.
- Required fields marked `*`; inline validation on blur + on submit; errors shown under field and summarized at top if submit blocked.
- `[Save]` = draft (editable), `[Submit]` = locks form to read-only for viewers (editors/admins can still reopen for edit per ACL).
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

---

## Visual Design Direction (for Phase 7 high-fi implementation)

ASCII layouts above = structure only. User-specified style for actual UI build:
- **Style:** modern, minimalist — generous whitespace, clean typography, no clutter/skeuomorphism
- **Color:** trẻ trung năng động (youthful/energetic) — vibrant accent palette, not corporate-flat gray/blue-only
- **Elevation:** soft drop-shadows on cards/panels/modals (not flat/borderless) for depth
- **Color transitions:** subtle/soft gradients (chuyển sắc độ nhẹ nhàng) on accents (buttons, brand bar, status chips) — not harsh hard-stop color blocks
- Applies to: dashboard cards, permission panel, buttons/CTAs, status badges, public-view theme-color bar (screen 5's per-project branding is the natural home for the gradient/accent treatment)
- Action: when Phase 7 (frontend admin app) starts, load `ui-ux-pro-max` or `ui-styling` skill to pick a concrete palette + font pairing matching this direction before building components — do not hardcode colors ad-hoc per component.

---

## Open Questions

1. **Public link scope**: one stable publish toggle per project (whole shared subtree), or per-node shareable links with independent expiry/revoke? Affects screen 2's `[Publish...]` action and screen 5 routing.
2. **External sharing model**: does `[Share]` in screen 2 invite by email only (with a role), or also support org-member picker + separate "external/client" link generation as a distinct flow?
3. **Client interaction on public view**: strictly read-only forever, or should we leave room for a future "leave a comment / request change" affordance on the public page (impacts data model now vs later)?
