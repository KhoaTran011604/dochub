# Phase 02: OIDC bridge + SSO token handoff + system_admin local

## Context Links

- [plan.md](./plan.md) · [phase 01](./phase-01-monorepo-and-outline-infra.md) · [project-brief](./project-brief-tasks-spec-architecture-and-locked-stack.md) mục 3.1
- [research 02](./research/researcher-02-oidc-provider-and-claude-api.md) Topic 1, 2 · [research 03](./research/researcher-03-sso-token-handoff-into-oidc-bridge.md) (đọc kèm mục "Sai trong research" bên dưới)
- [code review phase 1](../reports/code-reviewer-261001-1419-phase-01-monorepo-and-outline-infra.md) (W3, W6, S2, S3, S6)

## Overview

- Ngày: 2026-10-01
- Mô tả: service Node dùng `oidc-provider` 9.x làm IdP duy nhất của Outline. User ERP vào bằng link 1 click (JWT ngắn hạn do ERP ký); `system_admin` vào bằng form local (argon2id). Việc quan trọng nhất của cả plan → làm trước.
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 68h (8,5 ngày)

## Key Insights

Đã kiểm trên source Outline `v1.10.1`:

- 1 provider OIDC + không đặt `OIDC_DISABLE_REDIRECT` → màn login Outline tự chuyển sang `/auth/oidc` (`app/scenes/Login/Login.tsx`). Không cần fork.
- Deep link sống qua vòng OIDC: route cần đăng nhập gọi `logout({ savePath: true })` → `setPostLoginPath` ghi cookie `postLoginRedirectPath` + sessionStorage; sau login `AuthenticatedLayout` đọc lại và `history.replace`. Path bị loại: `/`, `/home`, `/create`, `/logout`, `/auth/*`, `/s/*`.
- `userProvisioner`: khớp user cũ theo (provider, `sub`); khớp account đã invite theo email CHỈ khi `emailVerified === true`, và email verified ghi đè email đang lưu → bridge luôn phát `email_verified: true`.
- Hệ quả bảo mật: ai điều khiển được claim email là chiếm được account Outline trùng email (kể cả admin). → **Email/tên KHÔNG lấy từ JWT**. JWT chỉ định danh (`sub` = erpUserId); hồ sơ lấy từ bảng `permission_api.erp_users` (ghi bởi API provision có service key, email unique). Token trên URL cũng không còn PII.
- Cookie phiên Outline `accessToken`: host-only, sống 3 tháng → bridge ở host khác không xóa được, kể cả khi chung registrable domain.

`oidc-provider`:

- `provider.setProviderSession` KHÔNG có trong tài liệu/changelog hiện hành → không dùng. Dùng `provider.interactionDetails` + `provider.interactionFinished(req, res, result)` và helper `loadExistingGrant` để cấp grant ngầm cho client first-party `outline`.
- `findAccount` được gọi lại ở token/userinfo chỉ với `sub` → đọc `erp_users` (hoặc env với `local:system_admin`). Không cần bảng `bridge.accounts`.
- Session bridge của user ERP không có giá trị (lần nào cũng vào bằng handoff) → `remember: false`, TTL ngắn, và `/sso` xóa cookie session cũ để handoff luôn thắng.

Sai trong research (bỏ qua): `setProviderSession` "VERIFIED" (sai); `@josesuite/node` không tồn tại, thư viện là `jose` (`jwtVerify`, `createRemoteJWKSet`, `importSPKI`).

## Giả định + fallback (thử ngay ngày 1, bước 2)

| Giả định | Sai thì |
|---|---|
| Outline nhận `OIDC_AUTH_URI/TOKEN_URI/USERINFO_URI` HTTP ở local | Reverse proxy TLS tự ký trong compose |
| Auto-redirect sang OIDC chạy (đã đọc source) | User bấm 1 nút "Continue with …" trên màn login Outline; chấp nhận |
| Deep link `/doc/...` giữ được qua login (đã đọc source) | User bấm lại link ERP (đã có phiên → vào thẳng doc); ghi vào tài liệu ERP |
| `email_verified: true` → khớp account đã invite, không tạo trùng | Bỏ pre-provision: user tạo ở lần login đầu, phase 4 tra id theo email |
| `loadExistingGrant` bỏ được consent cho client `outline` | Tự tạo grant trong interaction handler (mẫu trong repo thư viện) |
| User đầu tiên login Outline mới cài thành admin | `users.update_role`; cuối cùng mới sửa role trong Postgres (ghi runbook) |

Quá 2 ngày chưa login trọn luồng → dừng, báo user.

## Hoãn từ review phase 1 (làm ở bước 1)

| # | Quyết định |
|---|---|
| W3 | Tách role DB: `bridge_app`, `permission_api_app` (login); `hd_document_apps` chỉ là owner chạy migration. Thêm vào `infra/postgres-init/01-create-databases.sql` (chỉ chạy trên volume trống → dev `docker compose down -v`; README ghi SQL chạy tay cho volume cũ). GRANT theo bảng trong migration. |
| W6 | Dockerfile multi-stage: `tsc` build → `node dist`. Không `tsx` ở runtime. Pin `.nvmrc` tới minor. |
| S2 | Bật ESLint type-aware (`recommendedTypeChecked`, có `no-floating-promises`). |
| S6 | Bridge port 4000. `OIDC_AUTH_URI=http://localhost:4000/auth` (trình duyệt resolve); `OIDC_TOKEN_URI`/`OIDC_USERINFO_URI=http://oidc-bridge:4000/...` (container resolve). Khai tay, không dùng discovery. |
| S3 | CI: lint + typecheck file config ở root; chạy migration bằng role owner, không phải superuser. |

Mang sang từ phase 1: upload file đính kèm (bước 12); quyền file dump trên Linux (khi có máy Linux).

## Requirements

Chức năng:
- Authorization code flow cho client `outline` (confidential, `client_secret_basic`, redirect `{outline}/auth/oidc.callback`).
- `GET /sso?token=<jwt>&returnTo=<url>`: xác thực JWT ERP → đăng nhập không mật khẩu → về `returnTo`.
- Form login chỉ dành cho `system_admin` (username + hash argon2id từ env, m=19456, t=2, p=1). Có 1 dòng hướng dẫn "Người dùng ERP: mở tài liệu từ ERP" + link `ERP_PORTAL_URL` (nếu cấu hình).
- Claim: `sub`, `email`, `email_verified: true`, `name`, `preferred_username`.
- `sub`: `erp:<erpUserId>` hoặc `local:system_admin`. `/sso` không bao giờ cho ra `local:system_admin`.
- User ERP phải có trong `erp_users` và `status = active`; không thì từ chối + audit.
- Lockout form + audit mọi lần login/handoff + `/healthz`.
- CLI dev đóng vai ERP: sinh keypair, ký link handoff, seed user.

Phi chức năng:
- Bridge chỉ phụ thuộc Postgres. Không gọi ERP ở runtime (trừ lấy JWKS nếu cấu hình URL; có cache).
- Token không vào log; cookie `httpOnly`, `sameSite=lax`, `secure` khi HTTPS.
- File < 200 dòng.

## Architecture

```
ERP ── link ──> GET bridge/sso?token&returnTo
                 1 kiểm Referer thuộc SSO_ALLOWED_REFERRER_ORIGINS
                 2 jose.jwtVerify (ES256|RS256, iss, aud, exp, kid)
                 3 INSERT sso_handoffs(jti)         ← trùng = replay
                 4 erp_users: tồn tại + active
                 5 returnTo ∈ allow-list
                 6 xóa cookie session bridge cũ; set cookie hd_sso_handoff
                 └─ 302 returnTo  (Referrer-Policy: no-referrer, Cache-Control: no-store)
Outline (chưa có phiên) ─ lưu postLoginPath ─> /auth/oidc ─> bridge /auth
   └─> /interaction/:uid
         ├ có handoff hợp lệ → consume 1 lần → interactionFinished({ login: { accountId: 'erp:<id>', remember: false } })
         └ không có → form system_admin
   └─> loadExistingGrant (client outline) → code → Outline callback → doc
```

Hợp đồng JWT (đề xuất, chờ ERP xác nhận):

| Phần | Giá trị |
|---|---|
| Header | `alg` ES256 (chấp nhận RS256 qua env), `kid`, `typ: JWT` |
| `iss` / `aud` | `ERP_SSO_ISSUER` / `ERP_SSO_AUDIENCE` (mặc định `hd-document-sso`) |
| `sub` | erpUserId ổn định (không phải email) |
| `iat`, `exp` | `exp - iat` ≤ 60s; bridge từ chối nếu > `SSO_TOKEN_MAX_LIFETIME_SECONDS` (120); clock tolerance 30s |
| `jti` | UUID, dùng 1 lần |
| Khóa | `ERP_SSO_JWKS_URL` (`createRemoteJWKSet`, xoay khóa theo `kid`) hoặc `ERP_SSO_PUBLIC_KEY_PEM` (`importSPKI`) |

`returnTo` allow-list (so `new URL(x).origin` tuyệt đối, cấm userinfo): origin Outline (mọi path) · origin permission API + path bắt đầu `/pending/` (phase 5). Thiếu `returnTo` → trang gốc Outline.

Token hỏng/hết hạn/replay: nếu `returnTo` hợp lệ → 302 `returnTo` **không kèm handoff** (user đang có phiên Outline vẫn đi tiếp, F5 không vỡ); ngược lại → trang lỗi text + link ERP. Luôn audit.

Handoff: 1 bảng cho cả chống replay lẫn trạng thái chờ.

```
bridge.sso_handoffs(jti PK, handoff_id UNIQUE, erp_user_id, token_expires_at,
                    handoff_expires_at, consumed_at, ip, created_at)
```

Cookie `hd_sso_handoff` = `handoff_id` ngẫu nhiên 32 byte (không chứa account), ký bằng keygrip của Koa, path `/interaction`, max-age 120s. Consume: `UPDATE … SET consumed_at = now() WHERE handoff_id = $1 AND consumed_at IS NULL AND handoff_expires_at > now() RETURNING erp_user_id`.

Quyết định cho 3 tình huống:

| Tình huống | Điều xảy ra | Quyết định |
|---|---|---|
| Trình duyệt đang có phiên Outline của user KHÁC | Outline không hỏi IdP → mở doc bằng user cũ; handoff hết hạn không dùng | **Hạn chế chấp nhận + ghi tài liệu.** Giảm thiểu: ERP khi logout điều hướng qua `{outline}/logout` (kiểm khi làm). Chung registrable domain KHÔNG đủ (cookie host-only). Nâng cấp nếu cần: đặt bridge cùng host Outline qua reverse proxy theo path để `/sso` ghi đè `accessToken` (+1 ngày), hoặc `/sso` luôn đi qua `{outline}/logout` (làm rớt các tab khác) |
| Bridge đang có session của `sub` khác | Provider sẽ trả luôn account cũ, bỏ qua handoff | `/sso` xóa cookie session bridge → luôn vào interaction → handoff thắng. Fallback: thêm `Check` vào `interactionPolicy` |
| Login CSRF (kẻ xấu gửi nạn nhân link mang token của CHÍNH kẻ xấu) | Nạn nhân chưa có phiên → vào Outline dưới tên kẻ xấu, viết nội dung vào chỗ kẻ xấu đọc được | Chọn: (1) `exp` ≤ 60s + `jti` 1 lần; (2) bắt buộc `Referer` thuộc origin ERP (link từ mail/chat/trang lạ bị chặn; tắt được bằng env). Rủi ro còn lại (chấp nhận): cần là người trong ERP + ERP có open redirect; lần theo được qua audit (`jti`, `sub`, IP). Nâng cấp khi chung domain: ERP đặt cookie ràng buộc phiên, JWT mang hash. Không chọn: POST handoff (trang lạ vẫn auto-submit được), trang xác nhận (trái "1 click, không UI riêng") |

Bảng (migration 0002): `bridge.oidc_payloads`, `bridge.sso_handoffs`, `bridge.login_attempts`, `bridge.auth_audit_log`; đổi tên schema `companion` → `permission_api` (schema đang rỗng, 1 dòng `ALTER SCHEMA`; không sửa 0001); `permission_api.erp_users(erp_user_id PK, email UNIQUE theo lower, display_name, outline_user_id NULL, status, created_at, updated_at)`. `bridge_app` chỉ `SELECT` trên `erp_users`.

## Related Code Files

Tạo `apps/oidc-bridge/`:
- `Dockerfile`, `package.json`, `tsconfig.json`
- `src/server.ts`
- `src/config/environment-config.ts`
- `src/provider/oidc-provider-configuration.ts`
- `src/provider/oidc-client-registry.ts`
- `src/provider/postgres-oidc-storage-adapter.ts`
- `src/provider/find-account-and-claims.ts`
- `src/provider/load-existing-grant-for-first-party-client.ts`
- `src/sso/sso-handoff-route.ts`
- `src/sso/verify-erp-handoff-token.ts`
- `src/sso/erp-public-key-resolver.ts`
- `src/sso/validate-return-to-url.ts`
- `src/sso/check-sso-request-referrer.ts`
- `src/sso/sso-handoff-repository.ts`
- `src/accounts/erp-user-directory-reader.ts`
- `src/interactions/login-interaction-routes.ts`
- `src/interactions/login-page-view.ts`
- `src/auth/local-system-admin-authenticator.ts`
- `src/auth/login-rate-limiter-and-lockout.ts`
- `src/audit/auth-audit-logger.ts`
- `src/health/health-check-route.ts`
- `scripts/generate-system-admin-password-hash.ts`, `scripts/generate-signing-jwks.ts`
- `scripts/dev/generate-dev-erp-signing-keypair.ts`
- `scripts/dev/sign-dev-sso-handoff-link.ts`
- `scripts/dev/seed-dev-erp-user.ts`

Tạo khác:
- `packages/app-database/migrations/0002-rename-companion-schema-and-create-bridge-and-erp-user-tables.sql`
- `tests/e2e/playwright.config.ts`, `tests/e2e/sso-handoff-link-opens-document-as-erp-user.spec.ts`

Sửa: `infra/docker-compose.yml` (service `oidc-bridge`), `infra/.env.example` (biến bridge, `OIDC_*`, comment "schema bridge, permission_api"), `infra/postgres-init/01-create-databases.sql` (2 role app), `infra/README.md`, `eslint.config.mjs`, `.github/workflows/ci-lint-typecheck-test.yml`, `.nvmrc`.

Xóa: thư mục rỗng còn sót `packages/erp-adapters/` (không còn dùng).

## Implementation Steps

1. Việc hoãn từ phase 1: W3, W6, S2, S6, S3 (bảng trên).
2. **Ngày 1, đường xương sống:** provider tối thiểu (adapter in-memory, 1 account cứng, `email_verified: true`) + điền `OIDC_*` cho Outline → login trọn luồng. Kiểm 4 giả định đầu bảng: HTTP, auto-redirect, mở thẳng `/doc/<id>` khi chưa có phiên rồi quay lại đúng doc, user đầu tiên là admin. Ghi kết quả vào file này.
3. Migration 0002.
4. `environment-config.ts` (zod, fail nhanh): issuer, cookie keys, JWKS ký, client outline, `SYSTEM_ADMIN_USERNAME/EMAIL/PASSWORD_HASH`, `ERP_SSO_ISSUER/AUDIENCE`, `ERP_SSO_JWKS_URL | ERP_SSO_PUBLIC_KEY_PEM` (đúng 1), `SSO_ALLOWED_REFERRER_ORIGINS`, `OUTLINE_URL`, `PERMISSION_API_PUBLIC_URL`, `ERP_PORTAL_URL`.
5. Script: hash argon2id (password qua stdin), JWKS ký của bridge.
6. Storage adapter Postgres (mẫu từ repo thư viện) + job dọn `oidc_payloads`, `sso_handoffs` hết hạn.
7. Cấu hình provider: client từ env, claim theo scope, `loadExistingGrant` cho `outline`, TTL session 10 phút, tên cookie khai rõ.
8. `find-account-and-claims.ts`: `local:system_admin` → env; `erp:<id>` → `erp_users` (active). Từ chối nếu email user ERP trùng `SYSTEM_ADMIN_EMAIL`.
9. SSO: `verify-erp-handoff-token` → `sso-handoff-repository` → `validate-return-to-url` → `sso-handoff-route` (thứ tự như sơ đồ). Middleware log bỏ query string của `/sso`.
10. Interaction: GET `/interaction/:uid` → có handoff thì finish ngay; không thì form (CSRF token). POST login `system_admin` → lockout theo (username, IP) 5 lần/15 phút tăng dần + giới hạn theo IP → `interactionFinished`.
11. CLI dev: keypair ERP giả; `sign-dev-sso-handoff-link --erp-user-id --return-to` in ra link; `seed-dev-erp-user` ghi `erp_users` bằng role owner. Cả 3 từ chối chạy khi `NODE_ENV=production`.
12. Dockerfile + compose. `system_admin` login đầu tiên → kiểm là admin Outline; upload thử 1 PDF (tiêu chí còn mở của phase 1).
13. Test. Unit: verify token (sai chữ ký, hết hạn, sai `aud`/`iss`, lifetime quá dài, `alg` lạ), replay `jti`, `returnTo` (origin lạ, `//`, userinfo, path ngoài `/pending/`), Referer, lockout. Tích hợp: Postgres thật. E2E (Playwright, chromium): CLI ký link → mở → đứng ở đúng doc với đúng user, không thấy form nào.

## Todo List

- [ ] Việc hoãn phase 1 (role DB, runtime image, lint type-aware, hostname, CI)
- [ ] Ngày 1: login trọn luồng + kiểm 4 giả định, ghi kết quả
- [ ] Migration 0002 (rename schema, bảng bridge, `erp_users`, GRANT)
- [ ] Config env + script hash + JWKS
- [ ] Storage adapter Postgres + job dọn
- [ ] Cấu hình provider + `loadExistingGrant` + `email_verified`
- [ ] `findAccount` đọc `erp_users`
- [ ] `/sso`: verify JWT, replay, Referer, `returnTo`, cookie handoff, xóa session cũ
- [ ] Interaction: auto-finish theo handoff / form `system_admin` + CSRF + lockout
- [ ] Audit log + `/healthz`
- [ ] CLI dev (keypair, ký link, seed user)
- [ ] Docker + compose + env Outline; admin đầu tiên; upload thử file
- [ ] Unit + integration test
- [ ] Playwright: chuỗi redirect SSO
- [ ] Xóa `packages/erp-adapters/` còn sót

## Success Criteria

- Link ký bằng CLI dev → 1 click → đứng ở đúng doc Outline dưới đúng user, không nhập gì, không thấy màn login Outline hay form bridge.
- Mở lại cùng link (replay) khi đã có phiên → vẫn vào doc; khi chưa có phiên → không được đăng nhập.
- Token sai chữ ký / hết hạn / sai `aud` / `returnTo` ngoài allow-list / thiếu Referer hợp lệ → không tạo handoff, có audit.
- User không có trong `erp_users` hoặc `deactivated` → từ chối.
- `system_admin` login bằng form khi không có ERP nào; 5 lần sai → khóa tạm.
- Login lần 2 cùng `sub` không tạo user trùng trong Outline.
- Restart bridge: JWKS không đổi, luồng đang dở không hỏng.
- Không có token trong log của bridge.

## Risk Assessment

- Bridge chết → không ai login. Healthcheck + restart policy; break-glass = API key admin Outline cất offline (runbook phase 6).
- Hiểu sai API `oidc-provider` → bước 2 làm trước mọi thứ; cấu hình gom 1 file; chi tiết lấy từ tài liệu + ví dụ trong repo (skill `docs-seeker`), không theo trí nhớ.
- Hợp đồng JWT chưa được ERP xác nhận → thuật toán, issuer, audience, nguồn khóa đều là env; CLI dev đóng vai ERP nên không bị chặn.
- ERP đặt `Referrer-Policy: no-referrer` hoặc link có `rel=noreferrer` → kiểm Referer chặn nhầm. Ghi vào hợp đồng; có env tắt.
- Lệch đồng hồ ERP ↔ bridge > 30s → token bị từ chối. Ghi runbook (NTP).
- Phiên Outline của user khác (bảng trên): hạn chế đã chấp nhận.

## Security Considerations

- Chỉ nhận thuật toán bất đối xứng trong danh sách env; không bao giờ `none`/HS*.
- Token 1 lần, sống ≤ 60s, không log, không lưu nguyên văn (chỉ `jti`).
- `returnTo` so origin tuyệt đối → không open redirect.
- Handoff cookie không mang danh tính; trạng thái 1 lần nằm ở DB.
- Email/tên không đi qua trình duyệt; chỉ đến từ API provision có service key → chặn chiếm account qua email.
- Form: thông báo lỗi đồng nhất, CSRF, header bảo mật cơ bản, argon2id, password admin dài ngẫu nhiên.
- Redirect URI khớp tuyệt đối; client secret trong env.
- Không có endpoint quản trị trong bridge.
- CLI dev + khóa dev bị chặn ở production.

## Next Steps

- Phase 3: cấu hình workspace (`inviteRequired`…) + `outline-api-client`.
- Phase 4: API provision ghi `erp_users` (thay CLI seed).
- Phase 5: `returnTo` tới `/pending/*` của permission API được dùng thật.
- Gửi hợp đồng JWT + quy tắc dựng link cho đội ERP (bản nháp ở project-brief mục 3.1, bản chính ở phase 6).
