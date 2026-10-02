# Outline 1.10.x Permission API, User Provisioning & Branding — Research Report

**Date:** 2026-10-01 | **Researcher:** AI  

---

## CRITICAL CORRECTION: Previous Research Claims

**PR #13879 & #13857 are NOT merged.** Both remain open/closed without merge. Document-move permission propagation and OIDC group sync are **not** in v1.10.1. Verify expectations against actual Outline v1.10.1 code, not planned PRs.

---

## Recommendation

**Adopt this stack:**
1. **User provisioning:** Use `users.invite` with email pre-creation; OIDC login auto-links by email. Requires SMTP or fall back to admin pre-creating accounts manually.
2. **Acting as real user:** Use JWT/session capture via headless OIDC flow (server-side redirect walk) if IdP supports it; fallback: use an OAuth2 personal app (if self-hosted Outline supports it, unverified). **Avoid** API key creation on behalf (not supported/unverified).
3. **Permission API:** `documents.add_user`/`collections.add_user` with permission∈{read, read_write, admin}. All exist; admin-only requirement unverified but assumed.
4. **Config:** Use env vars for OIDC (mandatory); team name/logo likely team settings only (API-settable behavior unverified).

**Risks:** Permission inheritance on move not yet shipped; document-level membership behavior with no collection access untested in production.

---

## Q1: Permission API Surface — Existence & Parameters

**VERIFIED endpoints (v1.10.1, from API docs):**
- `documents.add_user` / `documents.remove_user`
- `documents.add_group` / `documents.remove_group`  
- `collections.add_user` / `collections.remove_user`
- `collections.add_group` / `collections.remove_group`
- `groups.create`, `groups.add_user`, `groups.remove_user`
- `users.invite`, `users.list`, `users.info`, `users.update_role`, `users.suspend`, `users.activate`
- `apiKeys.create` (inherits creator's permissions; no per-user creation confirmed)

**Permission values:** `read`, `read_write`, `admin` — VERIFIED.

**Who may call:** Bearer token + scope required; admin-only requirement **ASSUMED** (not explicitly documented).

**Missing endpoints:** No `documents.memberships` / `collections.memberships` query endpoint explicitly listed; assumed available for inspection.

**Source:** [Outline API Developers Portal](https://www.getoutline.com/developers)

---

## Q2: Permission Inheritance & Document-Level Scope

**Document-move permission propagation:** PR #13879 (fixes re-propagation) is **NOT MERGED**. Current v1.10.1 behavior **UNVERIFIED**; expect possible loss of child inheritance on move.

**Document-level membership without collection access:** **UNVERIFIED.** Assumed: user can view/edit shared document but sees it only in "Shared with me", cannot create children. Fallback: test in staging.

**Child document permission propagation:** PR #13857 (OIDC group sync) also unmerged. Parent → child inheritance model **ASSUMED** but unverified for v1.10.1.

**Moved document memberships:** **UNVERIFIED without PR #13879.** Fallback: re-apply permissions after move.

---

## Q3: Pre-Provisioning Users Before First OIDC Login

**users.invite:** Exists; creates user record with email + optional name. **VERIFIED** from search results & API docs.

**Email-based linking:** On first OIDC login, Outline matches invited user by email to OIDC identity. **VERIFIED** from deployment guides (Keycloak requires email + first name).

**No-SMTP fallback:** Admin can manually create users via API (invite endpoint response likely returns userId); no evidence of invite-without-SMTP mode. **ASSUMED:** direct user record creation via SQL only.

**Duplicate/reject behavior:** No user duplicate on OIDC link if email matches. **ASSUMED** from standard OIDC workflows.

**Env vars:** `OIDC_*` vars control auth; no `ALLOWED_DOMAINS` or invite-specific toggles documented. **ASSUMED:** all users in IdP can invite.

**Source:** [Outline API Developers](https://www.getoutline.com/developers); [deployment guides 2026](https://blog.gntech.me/posts/2026-06-08-outline-wiki-docker-deployment/), [Keycloak+Outline](https://blog.elest.io/outline-keycloak-sso-build-a-secure-team-wiki-with-single-sign-on/)

---

## Q4: Acting as Real User Without Interactive Consent

**(a) Built-in OAuth provider (self-hosted 1.10.x):**  
No self-hosted OAuth app registration endpoint documented. **UNVERIFIED / ASSUMED NOT AVAILABLE** for self-hosted. Outline's OAuth docs refer to cloud only.

**(b) Admin API key on behalf of user:**  
`apiKeys.create` inherits creator permissions; no per-user creation documented. **UNVERIFIED / NOT POSSIBLE** via API.

**(c) Headless OIDC login (own IdP):**  
BFF performs server-side OIDC flow: POST to `/auth/oidc` → IdP bridge → `/auth/oidc.callback` → capture `accessToken` cookie. **FEASIBLE if IdP supports server-side token exchange.** Session lifetime **UNVERIFIED** (likely 7–30 days default); no evidence of refresh token rotation for Outline sessions. **ASSUMED SUPPORTED** as standard OIDC practice.

**(d) Impersonate / createdById override:**  
No impersonate endpoint or document creation override documented. **NOT FOUND / UNVERIFIED.**

**Recommended approach:**  
- **Primary:** (c) Headless OIDC if IdP supports it.  
- **Fallback:** (a) Investigate self-hosted OAuth if a personal app can be created via admin panel (undocumented); manual session management otherwise.

---

## Q5: Config & Branding Without Fork

**Env vars (VERIFIED):**
- `OIDC_DISPLAY_NAME`, `OIDC_CLIENT_ID/SECRET`, `OIDC_AUTH_URI`, `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI`
- `OIDC_USERNAME_CLAIM` (default: `preferred_username`), `OIDC_LOGOUT_URI`
- `OIDC_SCOPES` (default: `openid profile email`)
- `OIDC_ISSUER_URL` (auto-discovery via `.well-known/openid-configuration`)

**Auto-redirect to OIDC:** `OIDC_DISABLE_REDIRECT` (env var heuristic). **UNVERIFIED** — fallback: hide email/guest signin UI via theme/CSS.

**Team name / logo / default role:** Likely team settings (not env vars). **ASSUMED:** changeable via UI admin panel; API (`team.update`) **UNVERIFIED.**

**Guest signin / email magic link:** Toggles presumed in admin panel; env vars **UNVERIFIED.**

**Default language (Vietnamese):** Likely `DEFAULT_LANGUAGE` or `LOCALE` env var. **UNVERIFIED.**

**Restrict workspace features:** Public sharing, user invites, collection creation by members. **ASSUMED:** admin toggles in UI; no API documented.

**Hardening approach:** Use env vars for auth; team settings via UI/admin panel; no API-based config discovered.

**Source:** [OIDC Docs](https://docs.getoutline.com/s/hosting/doc/oidc-8CPBm6uC0I); [Outline OIDC Docs](https://docs.getoutline.com/s/hosting/doc/oidc-8CPBm6uC0I)

---

## Q6: documents.create Under Document-Level Membership Only

**Required params:** `collectionId` (for collection scope) **or** `parentDocumentId` (for parent nesting). **VERIFIED** from API docs.

**Access control:** User with document-level membership but NO collection access: **UNVERIFIED.** Fallback: test creation; assume rejection or silently fails.

**publish: true behavior:** If true, document visible to collection members; if false, private to granted users. **ASSUMED** (not explicitly documented).

**Authorship:** Document created by authenticated user (bearer token owner). Real user authorship **VERIFIED** (token ≡ user identity).

---

## Unresolved Questions

1. Exact Outline v1.10.1 permission inheritance on parent move (PR #13879 unmerged).
2. OIDC group sync status in v1.10.1 (PR #13857 unmerged).
3. Self-hosted OAuth app registration endpoint / self-serve app creation.
4. `team.update` API existence & branding field names.
5. Exact session token lifetime & refresh behavior for OIDC logins.
6. Behavior: document-level membership with no collection access (doc creation, sidebar visibility).
7. All `admin-only` enforcement on permission endpoints.
