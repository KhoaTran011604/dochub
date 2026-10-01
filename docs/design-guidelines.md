# Design Guidelines — Project Document Hub Admin

Style ref: fintech dashboard screenshot (sidebar+card layout, lime/forest green, large-radius cards, hairline borders). Adapted for B2B doc-management admin. Modern, clean, professional. Small controls, thin borders — no heavy shadows/oversized buttons.

## Typography
- Font: **Plus Jakarta Sans** (Google Fonts) — geometric grotesk, close match to ref's numeral/letterforms. One family, vary weight. Do NOT use Inter/Poppins.
- Scale: display 32/700 (big KPI numbers) · h1 24/700 · h2 18/600 · h3 15/600 · body 14/500 · small 13/500 · tiny 12/600 (labels/badges, uppercase, letter-spacing .04em)
- Numerals: `font-variant-numeric: tabular-nums` on money/counts.

## Color tokens
```
--bg-app:        #F8F9F5   (page bg, warm light gray-green)
--bg-surface:     #FFFFFF   (cards, sidebar, topbar)
--border:         #E8EBE3   (hairline, 1px everywhere)
--border-strong:  #D7DBCE   (input/button borders)
--text-primary:   #14170F
--text-secondary: #6C7166
--text-tertiary:  #9BA093

--accent-lime:      #B7E043  (highlights, active chart bars, progress fill)
--accent-lime-dark: #93BB2E  (hover on lime)
--accent-forest:      #1E3B26  (primary buttons, active nav pill, dark chart bars)
--accent-forest-light:#2F5A3C  (hover on forest)

--success: #2F9E52  --success-bg: #E7F5EA
--warning: #D79A2C  --warning-bg: #FBF1DE
--danger:  #D65C4F  --danger-bg:  #FBEAE7
--info:    #3C7FD1  --info-bg:    #E7F0FB
```

## Spacing / radius (4px base)
Spacing: 4 8 12 16 20 24 32 40 48.
Radius: `--r-card:16px` `--r-panel:12px` `--r-control:8px` (buttons/inputs) `--r-pill:999px` (badges, nav, tags).
Borders always 1px solid, never >1px. Card shadow: `0 1px 2px rgba(20,23,15,.04)` only — no drop shadows.

## Components
- **Buttons**: h36 default / h32 compact (table row actions) / h40 large (page CTA). Padding-x 14–16px, radius-control, font 14/600.
  - Primary: bg accent-forest, white text, no border.
  - Secondary: bg white, 1px border-strong, text-primary.
  - Ghost: transparent, text-secondary, hover bg `#F1F3EC`.
  - Icon button: 32×32, radius-control, 1px border.
- **Inputs**: h36, 1px border-strong, radius-control, padding-x 12px. Focus: border accent-forest + 2px ring `rgba(183,224,67,.35)`.
- **Sidebar**: 240px, white bg, border-right hairline. Logo = wordmark only, no icon mark: `Doc` solid text-primary + `Hub` in a slight-skew forest→lime gradient (`.logo-accent`), 23px/800. No sidebar search box. Nav item h40, radius-pill; active = bg accent-forest/white text; hover = bg `#F1F3EC`.
- **Topbar**: h64, border-bottom hairline, icon buttons (theme toggle, share) + user chip, right-aligned. No floating/duplicate search button — search lives only in the global command palette (⌘K), not yet placed in these wireframes.
- **Cards**: white, 1px border, radius-card, padding 20–24px.
- **Table**: header row text-tertiary 11px uppercase tracked; rows h52, bottom hairline only (no vertical rules); status via pill badge.
- **Badges/pills**: pad 2px 10px, radius-pill, 12px/600. Pair bg+text per status token above (e.g. success-bg/success).
- **Tree (folder/doc nav)**: 28px row height, chevron toggle, icon (folder/page/form) + label, indent 16px/level, active row bg `#F1F3EC` + left 2px accent-forest bar.

## Reusable shell markup (copy verbatim into every screen, only change active state / page content)
```html
<div class="app-shell">
  <aside class="sidebar">
    <div class="sidebar__top">
      <div class="sidebar__logo">Doc<span class="logo-accent">Hub</span></div>
      <button class="sidebar__collapse">...</button>
    </div>
    <nav class="sidebar__nav">
      <a class="nav-item is-active" href="01-dashboard.html">Dashboard</a>
      <a class="nav-item" href="02-workspace.html">Projects</a>
      <a class="nav-item" href="06-templates.html">Templates</a>
      <a class="nav-item" href="05-permissions.html">Sharing</a>
      <a class="nav-item" href="07-public-site.html">Public Sites</a>
    </nav>
    <div class="sidebar__footer">
      <a class="nav-item" href="#">Settings</a>
    </div>
  </aside>
  <div class="app-main">
    <header class="topbar">
      <input class="search" placeholder="Search projects, docs…" />
      <div class="topbar__actions"><!-- icon buttons, avatar --></div>
    </header>
    <main class="content"><!-- page body --></main>
  </div>
</div>
```

## Screens (business flow)
1. **01-dashboard.html** — project list overview (KPI cards: total projects, docs, pending shares) + project card/table (name, folder/doc count, owner, status pill: active/draft/archived, updated date).
2. **02-workspace.html** — project workspace: left tree panel (folders→pages/forms), main panel = selected folder's doc list, right rail = node detail (owner, permission summary, trash link).
3. **03-editor-page.html** — BlockNote page doc: block-based editor mock (heading/paragraph/list/image blocks), top doc toolbar (share, AI draft, status).
4. **04-editor-form.html** — dynamic template form (RJSF-driven): field groups per JSON Schema, draft/submitted status pill, submit/reopen actions.
5. **05-permissions.html** — ACL panel: node tree w/ inherited-vs-explicit role dropdowns (none/viewer/editor/admin), invite-by-email (multi + role picker) modal.
6. **06-templates.html** — template management: list of templates (name, version, fields count, used-by-docs), schema field builder preview.
7. **07-public-site.html** — public branded read-only view: minimal top bar (project brand), doc tree nav, read-only content — no admin chrome.

## Fidelity
Wireframes are mid-fidelity, real sample copy (actual project/doc names from the domain, not lorem ipsum), static HTML+CSS only (no JS framework needed, minor JS OK for tree expand/collapse demo).
