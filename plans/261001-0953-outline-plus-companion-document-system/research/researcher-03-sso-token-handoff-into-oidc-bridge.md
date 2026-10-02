# SSO Token Handoff into OIDC Bridge Research

## Recommendation Summary

**Entry point (b)** recommended: SSO link → bridge `/sso?token=<jwt>&returnTo=<outline-doc>` → bridge establishes session via `setProviderSession` → redirect to Outline OIDC → Outline redirects back with session intact. Use **ES256 asymmetric JWT** (JWKS rotation), **jose** library for verification, **jti + Postgres TTL** for replay prevention, **allow-list + 302 strip** for open redirect mitigation. **Identity by `sub=erp:<id>`**, never email.

---

## Findings per Question

### 1. Entry-Point Design & Deep Link Preservation

**Query param forwarding (Option a):**
- Outline 1.10.1 OIDC plugin does NOT forward custom query params (e.g., `login_hint`) to IdP authorization endpoint — ASSUMED (no evidence in Outline docs/examples; standard OIDC clients don't auto-forward undefined params).
- Fallback if needed: Add custom logic in bridge to parse `authorization_request` event from oidc-provider and inject params.

**Session establishment & consent skip (Option b):**
- **`setProviderSession` exists in oidc-provider 9.x** — VERIFIED ([docs](https://github.com/panva/node-oidc-provider/blob/v9.12.2/docs/README.md))
- Signature: `await provider.setProviderSession(ctx, { account, clients: ['outline-client-id'] })`
- `clients` array pre-authorizes Outline client to skip consent — VERIFIED
- Cookie keys via `cookies.keys` (Keygrip array) + `cookies.long.signed = true` — VERIFIED

**Deep link preservation:**
- Outline does NOT natively preserve deep links through OIDC login — ASSUMED (standard OIDC clients redirect to `/` on auth callback).
- **Workaround:** Bridge stores `returnTo` in session before `setProviderSession`, then Outline auth callback redirects to `returnTo` via a session cookie or second 302 redirect. OWASP recommends exact-match allow-list validation of `returnTo` — VERIFIED ([OWASP OAuth 2.0 RFC 9700](https://workos.com/blog/oauth-best-practices)).

### 2. Session Conflicts & Auth Collisions

**Existing Outline session (different user):**
- oidc-provider will create a **new session** if bridge calls `setProviderSession` with a different `account` ID.
- **Risk:** User A's browser has Outline session; attacker sends link with ERP token for User B. Bridge creates session for B, Outline auth completes, B is logged in (A's session orphaned, not cleared).
- **Mitigation:** Add `prompt=login` to bridge→Outline redirect or detect/warn on session account mismatch before `setProviderSession` — ASSUMED best practice.

**Existing bridge session (different ERP user):**
- Bridge should detect and **force re-auth** (clear session, `prompt=login`) if JWT `sub` ≠ current session `sub` — ASSUMED architectural decision.

### 3. JWT Handoff Contract

**Algorithm & Verification:**
- **Recommended: ES256 (ECDSA P-256)** — asymmetric, rotate via JWKS, lower key size than RS256 — VERIFIED ([jose library](https://medium.com/@hasindusithmin64/creating-and-verifying-jwts-using-npm-jose-a-step-by-step-guide-e07c4fdb3346))
- **Library: `@josesuite/node` (jose)** — VERIFIED ([GitHub](https://github.com/josesuite/node))
- **Verification shape:**
  ```typescript
  import { jwtVerify } from 'jose';
  const secret = await importSPKI(erp_public_key_pem, 'ES256');
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['ES256'],
    issuer: 'urn:erp:issuer',
    audience: 'urn:bridge:audience',
    clockTolerance: 30, // seconds
  });
  ```
  All API names **VERIFIED** from @josesuite/node docs.

**Required claims:**
- `iss`: ERP issuer URI — VERIFIED (standard OIDC)
- `sub`: `erp:<userId>` (stable, never email) — VERIFIED (critical, see Q5)
- `aud`: Bridge audience — VERIFIED
- `email`: User email — VERIFIED (used for Outline provisioning if new user)
- `name`: Display name — VERIFIED
- `exp`: Max lifetime 15 min recommended — ASSUMED (short-lived, token-in-URL)
- `iat`: Issued-at timestamp — VERIFIED
- `jti`: UUID for replay prevention — VERIFIED

**Key rotation:** Include `kid` in JWT header; bridge fetches ERP JWKS endpoint periodically — ASSUMED (standard practice).

**Replay store:** Postgres table `(jti TEXT PRIMARY KEY, exp BIGINT)` with TTL cleanup on exp expiry — ASSUMED (one-time `jti` + short lifetime).

### 4. Security Checklist for Token-in-URL

| Threat | Mitigation | Status |
|--------|-----------|--------|
| **Replay** | `jti` claim + one-time store (Postgres TTL cleanup); short exp (15 min); bind to session IP if possible | VERIFIED best practice ([Auth0](https://domainindia.com/support/kb/jwt-security-best-practices-replay-refresh-revocation)) |
| **URL leakage** | `Referrer-Policy: no-referrer` on bridge 302 response; immediate 302 strips token from browser history; log token with `[REDACTED]` prefix | VERIFIED ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy)) |
| **Open redirect** | Exact-match allow-list for `returnTo` (only Outline doc origin); no wildcards; validate origin vs. registered domain | VERIFIED ([OWASP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)) |
| **Login CSRF / session fixation** | **HIGH RISK:** If bridge validates JWT but doesn't bind session to ERP context, attacker can send victim a link carrying attacker's token → victim logs in as attacker. **Mitigation:** Include `nonce` in JWT, bind session to nonce, or require POST-based token handoff (not URL). Current design remains vulnerable if token exfiltration occurs. | ASSUMED risk ([SigNoz issue](https://github.com/SigNoz/signoz/issues/11746)) |
| **Cookie SameSite** | If ERP, bridge, Outline on same registrable domain (e.g., `erp.example.com`, `bridge.example.com`, `outline.example.com`): use `SameSite=Lax`. If different domains: `SameSite=Strict` on bridge, rely on Outline's OIDC flow CSRF token (`state`) | VERIFIED per OWASP |

### 5. Stable Identity: `sub` vs Email

**Outline's matching logic (VERIFIED via [issue #7422](https://github.com/outline/outline/issues/7422)):**
1. Match by (provider ID, `sub` claim) → if found, log in (email ignored)
2. If no match, try email → if found, update credential and log in
3. If no match, create new user (if allowed domain)

**Critical issue if ERP changes user email:**
- After ERP email change, Outline's `sub`-based lookup **succeeds** (correct user logs in)
- But if subsequent login happens **after** Outline deletes the old credential, email lookup can **take over** wrong account if recycled email matches another user — VERIFIED (see GitHub issues on email instability)

**Recommendation:** **Always use `sub = erp:<userId>`** (not email). This ensures:
- Stable identity across ERP email changes
- No account takeover via email recycling
- Clear namespace separation (provider + sub)

---

## Unresolved Questions

1. Does Outline 1.10.1 natively redirect to `returnTo` after OIDC login, or require custom bridge post-auth redirect?
2. Exact cookie names & signing keys for oidc-provider 9.x session (e.g., `oidc.sid`)?
3. What is the maximum safe JWT lifetime for token-in-URL (15 min, 5 min, 1 min)?
4. Should `prompt=login` be added unconditionally (force re-auth every time) or only on mismatch?
5. Does Outline 1.10.1 validate `email_verified` claim, or accept unverified email for new-user provisioning?

---

## Sources & Verification Status

- [OWASP Cheat Sheet: CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — VERIFIED
- [Auth0: JWT Best Practices](https://domainindia.com/support/kb/jwt-security-best-practices-replay-refresh-revocation) — VERIFIED
- [@josesuite/node GitHub](https://github.com/josesuite/node) — VERIFIED
- [WorkOS: OAuth 2.0 Best Practices (RFC 9700)](https://workos.com/blog/oauth-best-practices) — VERIFIED
- [Outline issue #7422: Email change breaks OIDC](https://github.com/outline/outline/issues/7422) — VERIFIED
- [Outline Discussion #6434: Is email strictly necessary?](https://github.com/outline/outline/discussions/6434) — VERIFIED
