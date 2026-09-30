# Research: Open-Source Notion/Confluence-Like Platforms

**Date:** 2026-09-30  
**Scope:** Evaluate 6 OSS doc platforms for self-hosting with Node.js+PostgreSQL stack

## Executive Summary
Evaluated Docmost, Outline, AFFiNE, Wiki.js, BookStack, AppFlowy. Best candidates: Docmost (strong stack match + perms + public sharing), Wiki.js (maximum extensibility). Others unsuitable: wrong tech stack, commercial lock-in, or limited feature set.

---

## Platform Comparison

### 1. **Docmost** ✓✓✓
- **License:** AGPL-3.0 (free, no per-seat fees)
- **Stack:** NestJS + Fastify + PostgreSQL + Redis → **Perfect match**
- **Permissions:** Page-level inheritance (restricted parents block child access); Spaces support; granular role controls
- **Public Sharing:** Page-level public wikis supported; can disable at workspace/space level; no custom domain/branding mentioned
- **SSO:** SAML & OIDC in Enterprise tier only; free tier = email/password
- **Extensibility:** Moderate API; cursor-based pagination & Search API recently improved; not designed as extensible platform
- **Maintenance:** Active (v0.95.0+, 2025 commits, performance optimizations ongoing)
- **Notes:** Best tech stack alignment; AGPL requires derivative works stay open-source

### 2. **Outline** ✓
- **License:** BSL 1.1 (not OSI-approved; allows self-host but restricted commercial use)
- **Stack:** Node.js + React + PostgreSQL + Redis → **Good match**
- **Permissions:** Hierarchical structure; group-based permission rules; not explicitly folder-level inheritance
- **Public Sharing:** Limited info; has Slack/Figma/Google Docs integrations but public link customization unclear
- **SSO:** OIDC auto-discovery supported (out-of-box); SAML in Business+ only
- **Extensibility:** Integration-heavy approach (Slack, Zapier, Airtable); core monolith
- **Maintenance:** Active (Node.js/React stack); recent commit activity unclear
- **Notes:** BSL license adds commercial friction; shared workspace model may not suit per-project access controls

### 3. **Wiki.js** ✓✓
- **License:** AGPL-3.0 (fully open-source, no paid tiers)
- **Stack:** Node.js + Express + GraphQL + PostgreSQL → **Good match**
- **Permissions:** Granular page-level; group rules support prefix match, regex, exact path, tags; inheritance via groups
- **Public Sharing:** Page-based system supports public access; guest access possible
- **SSO:** OIDC & SAML both supported; Keycloak integration documented
- **Extensibility:** **Plugin system (auth, search, storage, rendering, logging, analytics)** loaded at runtime → highly modular & extensible
- **Maintenance:** Active (v2.5.308 Aug 2025, ongoing security updates)
- **Notes:** Most extensible option; AGPL requires derivative works stay open-source; may need custom plugins for project-management layer

### 4. **BookStack** ✓
- **License:** MIT (fully open-source; most commercial-friendly)
- **Stack:** PHP/Laravel + MySQL/MariaDB (NOT Node.js; NOT PostgreSQL)
- **Permissions:** Role-based + entity-level (Shelf/Book/Chapter/Page); child entities inherit until overridden
- **Public Sharing:** Guest role for anonymous access; custom permissions per shelf/book/chapter/page
- **SSO:** LDAP & SAML group syncing; OAuth (Google)
- **Extensibility:** Limited; "Logical Theme System" for PHP customization; not designed as extensible platform
- **Maintenance:** Active (v25.11 Dec 2025; Laravel 11→12 upgrade)
- **Notes:** Stack mismatch (PHP/MySQL not Node.js/Postgres); MIT license most permissive; solid for traditional wiki use-cases

### 5. **AFFiNE** ✗
- **License:** MIT frontend + AFFiNE Enterprise Edition backend (commercial open-core)
- **Stack:** Rust backend (OctoBase) + CRDTs (Y-Octo) + Docker/PostgreSQL → **Stack mismatch** (Rust not Node.js)
- **Permissions:** Page-by-page sharing (View/Commenter/Editor); folder inheritance = **feature request** (incomplete)
- **Public Sharing:** Workspace & page-level public sharing; custom domain/branding = **feature requests** (not yet available)
- **SSO:** Not mentioned in docs
- **Extensibility:** BlockSuite toolkit open-source (custom blocks possible); core is monolith; backend closed-source (commercial)
- **Maintenance:** Active (v0.27.0, regular updates)
- **Notes:** Commercial backend lock-in; Rust backend requires different skill set; permission inheritance incomplete

### 6. **AppFlowy** ✗
- **License:** AGPL-3.0 frontend + Commercial self-hosted backend (open-core)
- **Stack:** Rust + Flutter + proprietary Node backend (closed-source) → **Stack complexity** (not pure Node.js)
- **Permissions:** Space-level + Page-level (View/Edit); guest editors (Pro Plan); inheritance unclear
- **Public Sharing:** Workspace & page public sharing; forms with anonymous/identified modes
- **SSO:** Not mentioned
- **Extensibility:** Limited by commercial backend; open-core model restricts customization
- **Maintenance:** Active (v0.9.4+ July 2025); but backend locked
- **Notes:** Significant commercial backend lock-in; self-hosted backend requires commercial license; least suitable for open-source fork

---

## Recommendation

**Best Choice: Docmost** — Ideal for your use case. Perfect tech stack (NestJS+Postgres), active development, strong permission inheritance, page-level public sharing. Only limitation: SSO (SAML/OIDC) requires Enterprise tier; free tier uses email/password. AGPL license requires derivative works remain open-source (acceptable if internalized only or made public).

**Alternative if maximum extensibility required: Wiki.js** — Excellent plugin architecture lets you build custom project-management layer on top. Same Node.js+Postgres stack, AGPL, SAML/OIDC built-in. Granular permissions less intuitive than Docmost's space-based model.

**Do not recommend:** Outline (BSL commercial friction), AFFiNE (incomplete permissions, Rust backend, commercial lock-in), AppFlowy (commercial backend), BookStack (PHP stack mismatch). Custom build justified only if you need tight project-management layer integration or per-client branding (custom domains/logo per share link) not provided by Docmost/Wiki.js within 1-3 month timeline.

---

**Unresolved Questions:**
- Does Docmost free tier support SAML/OIDC? (Appears Enterprise-only; may need to verify licensing model)
- Can Docmost pages be published with custom domain per client?
- Does Wiki.js plugin system scale for teams modifying it regularly?
- AppFlowy self-hosted backend licensing: is "free tier" truly free or trial?

## Sources
- [Docmost Documentation](https://docmost.com/docs/)
- [Docmost GitHub Releases](https://github.com/docmost/docmost/releases)
- [Outline GitHub](https://github.com/outline/outline)
- [Wiki.js Official](https://js.wiki/)
- [AFFiNE GitHub](https://github.com/toeverything/AFFiNE)
- [BookStack Official](https://www.bookstackapp.com/)
- [BookStack Release v25.11](https://www.bookstackapp.com/blog/bookstack-release-v25-11/)
- [AppFlowy GitHub](https://github.com/AppFlowy-IO/AppFlowy-Cloud)
- [Wiki.js Features (SaaSWorthy 2025)](https://www.saasworthy.com/product/wiki-js)
- [Docmost Overview (Contabo)](https://contabo.com/blog/what-is-docmost/)
