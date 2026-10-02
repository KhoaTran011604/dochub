# Phase 01: Bridge đăng nhập user qua IdP thật (upstream OIDC)

## Context Links

- [plan.md](./plan.md) · [phase 02 cũ](../261001-0953-outline-plus-companion-document-system/phase-02-oidc-bridge-sso-token-handoff-and-local-system-admin.md)
- Code: `apps/oidc-bridge/src/interactions/login-interaction-routes.ts`, `src/config/environment-config.ts`, `src/create-bridge-application.ts`
- IdP: `https://idp.hdwebsoft.co/.well-known/openid-configuration` (OpenIddict; RS256; PKCE S256; `client_secret_basic|post`; scope `openid profile email roles`)

## Overview

- Ngày: 2026-10-02 · Priority: P1 · Status: **Implemented (Step 1–7 done; step 8 chờ user)** · Effort: ~1 ngày
- Bridge giữ vai IdP của Outline, nhưng khi user chưa có handoff thì **chuyển tiếp sang IdP thật** (authorization code + PKCE) thay vì hiện form. Form `system_admin` giữ lại làm break-glass.

## Key Insights

- `id_token` IdP trả: `sub` (UUID v7), `email`, `email_verified: true`, `name`, `given_name`, `family_name`; sống 1200s; **không có `jti`**. Access token là JWE → opaque, chỉ để gọi `/connect/userinfo`.
- Email/tên từ IdP về bridge qua token endpoint (server↔server), không qua trình duyệt → tin được. Nhưng vẫn gate bằng `erp_users` để giữ hợp đồng phase 4–5 (status active, deactivate thu phiên).
- Trace của user: token request không gửi `client_secret` → `hd-dochub` đang là **public client**. Bridge chạy server-side nên confidential tốt hơn; cả 2 đều hỗ trợ qua env.
- `openid-client` v6 (panva, cùng tác giả `oidc-provider`/`jose`) làm discovery, PKCE, state/nonce, verify `id_token`. Không tự viết.

## Requirements

Chức năng:
- `GET /interaction/:uid` không có handoff → 302 tới IdP `authorize` (PKCE S256, `state`, `nonce`, scope `openid profile email`).
- `GET /upstream/callback?code&state` → đổi code, verify `id_token`, lấy `sub` → `readErpUser(sub)` → `interactionFinished({ login: { accountId: 'erp:<sub>', remember: false } })`.
- Trang `/interaction/:uid` hiện nút "Đăng nhập SSO" (→ `/interaction/:uid/upstream` → IdP) + form `system_admin` bên dưới; không tự chuyển sang IdP (user yêu cầu 2026-10-02). POST login giữ nguyên.
- User không có trong `erp_users` / deactivated → trang lỗi 403 hiện có + audit `upstream_login rejected`.
- Audit: `upstream_login` success/rejected (`state_mismatch`, `idp_error`, `unknown_user`, `deactivated`).

Phi chức năng:
- Transaction PKCE (`code_verifier`, `state`, `nonce`, `interactionUid`) lưu trong **cookie ký** `hd_upstream_login` (httpOnly, lax, path `/upstream`, maxAge 10 phút) — không thêm bảng (KISS).
- Không log `code`, token. File < 200 dòng.
- `ERP_SSO_*` + `/sso` giữ nguyên, nhưng trở thành **tùy chọn** khi có `UPSTREAM_OIDC_*`. Xóa ở phase sau khi IdP chạy ổn.

## Architecture

```
Outline → bridge /auth → /interaction/:uid
   ├ cookie handoff hợp lệ → finishLogin (giữ nguyên)
   ├ UPSTREAM_OIDC_ISSUER_URL có → set cookie hd_upstream_login{uid,verifier,state,nonce}
   │     → 302 idp/connect/authorize?client_id&redirect_uri=<bridge>/upstream/callback
   │                                  &code_challenge(S256)&state&nonce&scope
   │   IdP login → 302 <bridge>/upstream/callback?code&state&iss
   │     → openid-client authorizationCodeGrant (verify state, nonce, iss, chữ ký RS256 qua jwks_uri)
   │     → sub → readErpUser(sub) → interactionFinished(uid từ cookie) → Outline callback → doc
   └ không có upstream → form system_admin (như cũ)
```

Env mới (`environment-config.ts`, tất cả optional, superRefine: có ISSUER thì phải có CLIENT_ID):

| Biến | Giá trị |
|---|---|
| `UPSTREAM_OIDC_ISSUER_URL` | `https://idp.hdwebsoft.co` |
| `UPSTREAM_OIDC_CLIENT_ID` | `hd-dochub` |
| `UPSTREAM_OIDC_CLIENT_SECRET` | trống = public client + PKCE; có = `client_secret_basic` |
| `UPSTREAM_OIDC_SCOPES` | mặc định `openid profile email` |

Redirect URI đăng ký ở IdP: `${BRIDGE_PUBLIC_URL}/upstream/callback` → dev: `http://localhost:4001/upstream/callback`.

## Related Code Files

Tạo:
- `src/upstream/upstream-oidc-client.ts` — discovery (`openid-client` `discovery()`), cache config; `buildAuthorizationUrl`, `exchangeCode`.
- `src/upstream/upstream-login-transaction-cookie.ts` — set/read/clear cookie ký `hd_upstream_login` (JSON nhỏ).
- `src/upstream/upstream-callback-route.ts` — `GET /upstream/callback`.
- `src/upstream/upstream-callback-route.integration.test.ts` — IdP giả bằng `oidc-provider` in-memory (đã có harness) hoặc mock HTTP; test: state sai, nonce sai, user lạ, deactivated, thành công.

Sửa:
- `src/config/environment-config.ts` (+4 env, nới `ERP_SSO_*` thành optional khi có upstream)
- `src/interactions/login-interaction-routes.ts` (redirect upstream; tách form admin sang `/admin`)
- `src/create-bridge-application.ts` (wire route + client)
- `infra/.env.example`, `infra/docker-compose.yml` (4 env), `infra/README.md` (mục IdP thật thay erp-fake)
- `apps/oidc-bridge/package.json` (+`openid-client`)
- `docs/system-architecture.md`, `docs/project-changelog.md`

## Implementation Steps

1. Env + zod + compose + `.env.example`.
2. `upstream-oidc-client.ts`: `discovery(new URL(issuer), clientId, secret?)` 1 lần lúc boot (fail nhanh nếu IdP không tới được? → không: retry lazy, log warn, để bridge vẫn lên cho system_admin).
3. Cookie transaction + redirect trong `GET /interaction/:uid`.
4. Callback route: `authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier, expectedState, expectedNonce })` → `claims().sub`.
5. Tách form admin ra `/interaction/:uid/admin`; view thêm link.
6. Test tích hợp + chạy `pnpm typecheck && lint && test`.
7. README: hướng dẫn đăng ký client ở IdP (redirect URI, consent Implicit, secret).
8. Thử thật: đăng ký redirect URI → `docker compose up -d --build oidc-bridge` → mở `http://localhost:3000`.

## Todo List

- [x] Env + config
- [x] Upstream client + transaction cookie
- [x] Redirect từ interaction
- [x] Callback route + audit
- [x] Form admin sang `/admin`
- [x] Test tích hợp
- [x] README / docs / changelog
- [ ] Thử thật với IdP

## Kết quả (2026-10-02)

**Tests**: 93 total passed; 5 upstream integration tests (state, nonce, unknown user, deactivated, admin form) ✓; typecheck + lint ✓.

**Code Review**: Critical warnings W1 (redirect_uri consistency), W2 (reject http: issuer in prod), W3 (IdP-down + loop guard tests) fixed post-review; openid-client v6 PKCE S256, state, nonce, RS256 signature validation solid; no code/token leaked to logs; cookie signed httpOnly lax 10min.

**Step 8 Blocker**: Bridge redirects to IdP correctly (curl verified). Needs user to register `http://localhost:4001/upstream/callback` redirect_uri at IdP + attempt real login.

## Success Criteria

- Mở `http://localhost:3000/doc/<slug>` chưa có phiên → IdP login → quay về đúng doc, đúng user, không thấy form bridge.
- `sub` không có trong `erp_users` → trang 403 có link về ERP; audit ghi `unknown_user`.
- `state`/`nonce` sai → từ chối, không đăng nhập.
- Không có `UPSTREAM_OIDC_*` → hành vi cũ y nguyên (test cũ pass).
- IdP chết → nút SSO báo 503, form `system_admin` cùng trang vẫn vào được.

## Risk Assessment

- `sub` IdP ≠ id ERP dùng để provision → user hợp lệ bị `unknown_user`. Chốt với ERP trước khi seed.
- Consent "Explicit" → màn consent mỗi user lần đầu; đổi Implicit ở IdP.
- Bridge ở `localhost:4001` HTTP, IdP HTTPS: cookie `secure=false` ở dev là bình thường; production bắt buộc HTTPS + `TRUST_PROXY`.
- Discovery lúc boot phụ thuộc mạng ra ngoài từ container.

## Security Considerations

- PKCE S256 + `state` + `nonce` + kiểm `iss` (IdP hỗ trợ `authorization_response_iss_parameter_supported`).
- `id_token` verify RS256 qua `jwks_uri` (openid-client), kiểm `aud = client_id`, `exp`.
- Email/tên vẫn lấy từ `erp_users`, không từ IdP (giữ bất biến của phase 2). Có thể nới sau.
- Cookie transaction ký keygrip, path hẹp, 10 phút, xóa sau 1 lần đọc.
- Secret chỉ ở env; không log code/token.

## Next Steps

- Khi IdP chạy ổn: xóa `/sso` handoff, `ERP_SSO_*`, CLI `dev:sign-sso-link`, E2E handoff; viết lại E2E với IdP giả.
- Phase 4: provision `erp_users` với `erp_user_id = sub` của IdP.
- Logout: gọi `end_session_endpoint` của IdP khi Outline logout (tùy chọn, chưa cần).

## Unresolved Questions

1. `hd-dochub` public hay confidential (có secret)?
2. ERP provision user bằng `sub` của IdP hay id nội bộ khác?
3. Giữ gate `erp_users` hay cho IdP quyết (auto-provision từ claim)?
