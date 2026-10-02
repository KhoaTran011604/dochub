# Code Review: bridge as OIDC relying party of upstream IdP (GH-1)

Scope: `apps/oidc-bridge/src/upstream/*` (new), `fake-upstream-idp-server.ts`, diffs in config / interaction routes / app wiring / audit / harness / infra. All files < 200 lines. Typecheck, lint, 87 tests reported green by caller (not re-run here).

## Overall

Solid, small, and mostly by-the-book. PKCE S256 + state + nonce + iss are delegated to `openid-client` v6 (not hand-rolled); the transaction lives in a signed, httpOnly, lax, path-scoped (`/upstream`), 10-minute, read-once cookie; success is funnelled through the existing one-time handoff table so `/interaction/:uid` has a single completion path; no code/token reaches logs or audit (only the OAuth `error` code, never `error_description`). One real correctness bug behind reverse proxies; the rest is hardening and small DRY/test gaps.

## CRITICAL

None.

## WARNING

1. **`redirect_uri` at token exchange is derived from the request URL, not from config** — `upstream-login-routes.ts:111` passes `new URL(ctx.href)` to `completeLogin`; `upstream-oidc-client.ts:107` calls `authorizationCodeGrant(config, callbackUrl, checks)` without `options.redirectUri`, so openid-client sends `stripParams(currentUrl)` as `redirect_uri`. Behind a proxy where `Host`/`X-Forwarded-Host`/`X-Forwarded-Proto` do not reproduce `BRIDGE_PUBLIC_URL` exactly (internal hostname, `TRUST_PROXY=false` behind TLS, port rewrite), the authorize request used `settings.redirectUri` but the token request uses a different string -> IdP returns `invalid_grant` on every login, surfacing as `callback_invalid`. Tests cannot catch it (harness `Host` == `BRIDGE_PUBLIC_URL`). Fix (one line): build the URL from config and copy only the query: `const callbackUrl = new URL(settings.redirectUri); callbackUrl.search = ctx.search;` (or pass `{ redirectUri: settings.redirectUri }` as the 5th arg to `authorizationCodeGrant`). This also removes the dependency on `ctx.href` for a security-relevant value.

2. **`http:` issuer silently enables `allowInsecureRequests` in production** — `upstream-oidc-client.ts:67-69` keys the insecure switch on the issuer scheme only; `environment-config.ts:6` (`httpUrl`) accepts `http` for `UPSTREAM_OIDC_ISSUER_URL`. A typo'd `http://idp...` in prod would exchange codes (and a client secret, if set) in clear text. Add to the `superRefine`: `NODE_ENV === "production" && UPSTREAM_OIDC_ISSUER_URL?.startsWith("http:")` -> issue. Cheap, fail-fast.

3. **Untested paths: IdP down (503) and `?upstream=1` loop guard** — `createRedirectToUpstreamLogin` catch branch (`upstream-login-routes.ts:50-63`), `idp_unavailable` classification (`upstream-oidc-client.ts:103-104,138`) and `login-interaction-routes.ts:121` have no coverage. The fake IdP already exposes `stop()`; one test (stop IdP -> `GET authorizationUrl()` -> expect 503 + `/interaction/:uid/admin` still 200) would cover the break-glass promise in the plan's success criteria. Also missing vs. plan: `deactivated` user, `idp_denied` (`error=access_denied`). Nonce-mismatch is not practically testable through the browser path (cookie is signed) — acceptable to drop.

## SUGGESTION

4. **DRY: handoff cookie set duplicated** — `upstream-login-routes.ts:145-152` is a verbatim copy of `sso-handoff-route.ts:141-148`. Export `setSsoHandoffCookie(ctx, handoffId)` from `sso-handoff-route.ts` (next to the name/path constants) and use it in both. Same for the "IdP tạm thời không phản hồi" string at `upstream-login-routes.ts:59` and `:117` (one const).

5. **`ERP_SSO_ISSUER ?? ""`** — `create-bridge-application.ts` (tokenPolicy) and `bridge-test-harness.ts` (`setIssuer`) paper over a type the schema already guarantees. Lower-effort than restructuring the schema: keep as is but add a one-line comment pointing at the `superRefine` invariant, or have `isErpHandoffEnabled` return `{ issuer } | undefined` so the narrowing is real. Low priority.

6. **Redundant client metadata** — `upstream-oidc-client.ts:60-65` passes `client_secret` both in metadata and via `ClientSecretBasic`. `ClientSecretBasic(secret)` alone is sufficient; metadata can be `undefined` in both cases (KISS).

7. **Parallel tabs** — a second `/interaction/:uid` overwrites `hd_upstream_login`; the first tab's callback then fails with `callback_invalid` ("Mở lại tài liệu từ đầu"). Acceptable for KISS (plan explicitly chose cookie over table) — just be aware when reading audit logs; the reason will look like tampering.

8. **Audit noise** — every stray hit on `/upstream/callback` (scanners, bookmarks) writes a `transaction_missing` row. Fine for now; consider rate-limiting or downgrading to a log line if the table grows.

9. **Plan/docs not updated** — `phase-01` TODO list is all unchecked and `Status: Pending`; `docs/system-architecture.md` and `docs/project-changelog.md` listed under "Sửa" are untouched in `git status`. Step 8 "Thử thật với IdP" is not claimed done anywhere.

## Security checklist (verified OK)

- PKCE S256 verifier generated server-side, never leaves the signed httpOnly cookie; `code_challenge` only on the wire.
- `expectedState`, `expectedNonce`, `idTokenExpected: true` -> openid-client validates state, nonce, `iss` (when advertised), signature via `jwks_uri`, `aud`, `exp`.
- Cookie: signed (keygrip), httpOnly, `sameSite: lax` (correct for top-level GET return from IdP), `secure: ctx.secure`, path `/upstream`, 10 min, cleared on first read (`takePendingUpstreamLogin`). Replay without cookie / reuse of cookie both covered by tests.
- Open redirect: `ctx.redirect(authorizationUrl)` comes from discovery of the configured issuer; return path is `/interaction/${encodeURIComponent(uid)}` from the signed cookie. No user-controlled redirect target.
- Login CSRF: attacker-initiated callback URL has no matching transaction cookie in victim's browser -> `transaction_missing`.
- Leakage: `console.error` logs only `error.message` of discovery failure; audit `idpError` is the OAuth `error` code (`AuthorizationResponseError.error`, `ResponseBodyError.error`, `ClientError.code`) — never `error_description`, code, or tokens. `Cache-Control: no-store` + `Referrer-Policy: no-referrer` on the callback (URL carries `code`).
- `/interaction/:uid/admin` has the same exposure the form had before at `/interaction/:uid` (still gated by provider interaction cookie + CSRF).
- Identity/profile still sourced from `erp_users`, not IdP claims (phase-2 invariant kept; test asserts it).

## Recommended actions (priority order)

1. Fix `redirect_uri` derivation (W1) — 1-2 lines, then add a harness assertion or at least a comment.
2. Refuse `http:` upstream issuer when `NODE_ENV=production` (W2).
3. Add IdP-down / break-glass test and `deactivated` + `idp_denied` cases (W3).
4. Extract `setSsoHandoffCookie` (S4); drop redundant metadata (S6).
5. Tick the phase-01 TODOs, update changelog/architecture docs (S9).

## Unresolved questions

- Has a real login against `https://idp.hdwebsoft.co` been attempted (plan step 8)? The `redirect_uri` issue (W1) and issuer trailing-slash normalisation only show up there.
- Is `hd-dochub` registered as public or confidential at the IdP? Env supports both; README should state which is used in prod.
