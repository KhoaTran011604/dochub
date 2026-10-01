# Outline Self-Hosting & API Research Report

**Date:** 2026-10-01 | **Researcher:** AI  

---

## 1. Self-Hosting Docker Compose & OIDC Configuration

**CONFIRMED** — Production docker-compose.yml pattern:
- **Stack:** Outline + PostgreSQL 16+ + Redis 7 + MinIO or local file storage
- **Network:** Bridge network isolating containers, reverse proxy on port 3000
- **OIDC Required Env Vars:**
  - `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
  - `OIDC_AUTH_URI`, `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI`
  - Optional: `OIDC_USERNAME_CLAIM` (default: `preferred_username`)
  - Optional: `OIDC_DISPLAY_NAME`, `OIDC_SCOPES` (default: `openid profile email`)
  - Optional: `OIDC_LOGOUT_URI`, `OIDC_DISABLE_REDIRECT`
- **Auto-Discovery Option:** `OIDC_ISSUER_URL` (reads `/.well-known/openid-configuration`)

**Sources:**  
- [Outline OIDC Docs](https://docs.getoutline.com/s/hosting/doc/oidc-8CPBm6uC0I)
- [Bitdoze 2025 Guide](https://www.bitdoze.com/outline-install/)
- [GNTech 2026 Deployment](https://blog.gntech.me/posts/2026-06-08-outline-wiki-docker-deployment/)

**Latest Stable Version:** v1.10.1 (2026-09-09) per 2026 deployment guides; v1.9.0 also referenced. **UNVERIFIED** exact current stable as of 2026-10-01.

---

## 2. PR #13879: Moving Document Drops Child Permissions

**CONFIRMED — MERGED.** Fixes critical bug where moving a document removes inherited permissions on its children.

- **Issue:** Moving parent doc A removes group/user shares that child doc B inherited (children fall back to collection-only perms).
- **Root Cause:** DocumentMovedProcessor destroyed sourced memberships on move, never recreated them from moved doc's own memberships.
- **Fix:** Re-propagate root memberships from moved doc + all descendants after move transaction.
- **Tests Added:** Three cases covering own/child/grandchild membership re-propagation.

**Source:** [PR #13879](https://github.com/outline/outline/pull/13879)

**UNVERIFIED:** Which release version includes this merge (not confirmed in search results; need to check release notes/tags).

---

## 3. First User / Admin Role with OIDC-Only Auth

**UNVERIFIED.** Not found in available sources.

- **Questions:** 
  - Does first OIDC sign-in become admin automatically?
  - Can `users.update_role` set role via API?
  - Can `users.invite` pre-create users matched by email on OIDC login?

**Note:** User confirmed these endpoints exist; need to verify behavior under OIDC-only (no local auth).

---

## 4. PR #13857: OIDC Group Sync Provider

**CONFIRMED — MERGED.** Implements group sync for OIDC plugin (previously framework existed but no OIDC provider).

- **Solution:** Reads `groupClaim` (default: `groups`) from OIDC userinfo response; returns claim entries as external groups.
- **Tests:** Verified end-to-end against Authentik; groups sync on sign-in.
- **Limitation:** Flat key only (e.g., `custom.groups` unsupported; dotted paths not yet implemented).
- **Config:** `useGroupClaim` enabled; existing "Group claim" input surfaces.

**Source:** [PR #13857](https://github.com/outline/outline/pull/13857), [Group Sync Discussion](https://github.com/outline/outline/discussions/10750)

**UNVERIFIED:** Which release includes this merge.

---

## 5. API Details: documents.create, Links, OAuth, Rate Limits

**PARTIAL INFO — Mostly UNVERIFIED.**

### documents.create Response
**UNVERIFIED:** Exact response schema not found. Expected pattern (inferred):
```json
{ "ok": true, "data": { "documentId", "url"?, "urlId"? }, "policies": [...] }
```
**Need verification:** Does response include `url` or `urlId` for document link?

### Browser Link Format
**UNVERIFIED:** Assumed pattern: `https://{hostname}/documents/{documentId}` (not explicitly documented).

### OAuth 2.0 App Flow (Self-Hosted)
**UNVERIFIED.** Docs are minimal:
- Cloud: App registration via Settings => Applications; client credentials exchange
- Self-hosted: No clear docs on app registration endpoint, authorization endpoint, token endpoint
- **Missing:** PKCE support, refresh token behavior, CORS, token expiry

### Rate Limits
**PARTIAL:** Returns 429 + `Retry-After` header on limit; specifics (requests/min, per-user vs global) not documented.

### Base URL Format
**CONFIRMED:** Cloud uses `https://app.getoutline.com/api/method.name` with Bearer token; self-hosted infers `https://{your-domain}/api/method.name`.

**Source:** [getoutline.com/developers](https://www.getoutline.com/developers) (limited coverage for self-hosted & OAuth details)

---

## Summary Table

| Item | Status | Source |
|------|--------|--------|
| Docker Compose + OIDC env vars | ✅ CONFIRMED | Outline OIDC docs + 2026 guides |
| Latest stable version (2026-10-01) | ⚠️ v1.10.1 dated but unverified current | Deployment guides (2026-09-09) |
| PR #13879 merged (doc permission fix) | ✅ CONFIRMED | GitHub PR #13879 |
| PR #13879 release version | ❌ UNVERIFIED | Need release notes/tags |
| First user → admin with OIDC-only | ❌ UNVERIFIED | No source found |
| users.update_role, users.invite behavior | ❌ UNVERIFIED | No source found |
| PR #13857 merged (OIDC group sync) | ✅ CONFIRMED | GitHub PR #13857 |
| PR #13857 release version | ❌ UNVERIFIED | Need release notes/tags |
| documents.create includes url/urlId | ❌ UNVERIFIED | API docs incomplete |
| Browser link format | ⚠️ INFERRED | No explicit docs |
| Self-hosted OAuth app registration | ❌ UNVERIFIED | Not documented |
| PKCE, refresh tokens, rate limit detail | ❌ UNVERIFIED | API docs minimal |

---

## Unresolved Questions

1. Which release contains PR #13879 fix? (Check tags/releases from merge date)
2. Which release contains PR #13857? (Same)
3. Does `documents.create` response include `url` / `urlId` fields? (Check OpenAPI spec or test live API)
4. First OIDC user auto-promoted to admin? (Test or check code logic)
5. Can `users.invite` pre-create users, matched by email on OIDC login? (Test or code review)
6. Self-hosted OAuth app registration endpoint/flow? (Check GitHub docs or code)
7. Rate limit specifics (per-user, per-token, global; requests/time-window)? (Check code or API headers in practice)
8. Exact stable version as of 2026-10-01? (Check GitHub releases page)
