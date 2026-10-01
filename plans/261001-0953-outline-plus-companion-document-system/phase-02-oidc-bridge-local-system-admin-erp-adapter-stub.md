# Phase 02: OIDC bridge + system_admin local + ERP adapter stub

## Context Links

- [plan.md](./plan.md) · [phase 00](./phase-00-spike-and-risk-verification.md) (S2, S7, S8) · [phase 01](./phase-01-monorepo-and-outline-infra.md)
- [research 02](./research/researcher-02-oidc-provider-and-claude-api.md) Topic 1, 2
- [research 01](./research/researcher-01-outline-selfhost-and-api.md) mục 1 (env OIDC của Outline)

## Overview

- Ngày: 2026-10-01
- Mô tả: service Node độc lập dùng `oidc-provider` 9.x làm IdP cho Outline. Login bằng form: `system_admin` kiểm local (argon2id), user khác đi qua `ErpAuthAdapter` (stub trước).
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 64h (8 ngày)

## Key Insights

- `oidc-provider` dựa trên Koa, không gắn vào Next.js App Router → chạy tiến trình riêng.
- Không tự viết crypto: token/JWKS do `oidc-provider`, hash do thư viện `argon2`.
- `system_admin` phải chạy được từ ngày đầu và khi ERP down → nhánh xác thực local không được gọi ERP ở bất kỳ bước nào.
- `findAccount` được gọi lại sau login (token, userinfo) chỉ với `sub` → phải lưu profile (bảng `bridge.accounts`).
- Bridge là điểm chết duy nhất cho đăng nhập: giữ nhỏ, ít phụ thuộc (chỉ Postgres).
- Chi tiết interaction/consent/adapter lấy theo kết quả S7, không theo trí nhớ.

## Requirements

Chức năng:
- Authorization code flow cho client `outline` (confidential, `client_secret_basic`, redirect `{outline}/auth/oidc.callback`).
- Trang login 1 form username + password.
- `system_admin`: username từ env, so password với hash argon2id từ env (m=19456, t=2, p=1). Không qua ERP.
- User ERP: `ErpAuthAdapter.authenticate`. Chọn adapter bằng env: `stub` | `none` | `http` (phase 8).
- Claim phát ra: `sub`, `email`, `name`, `preferred_username`.
- Giới hạn tần suất + khóa tạm + audit log cho mọi lần login.
- `/healthz`.

Phi chức năng:
- ERP chậm/down: timeout ngắn, báo lỗi rõ cho user ERP, không ảnh hưởng `system_admin`.
- Session bridge: cookie `httpOnly`, `secure`, `sameSite=lax`.
- File < 200 dòng.

## Architecture

```
Outline ─/auth─> bridge (oidc-provider) ─interaction─> /interaction/:uid (form)
                                   POST login
                                     ├ username == SYSTEM_ADMIN_USERNAME → argon2.verify(hash env)
                                     └ khác → ErpAuthAdapter.authenticate (timeout)
                                   upsert bridge.accounts → interactionFinished → code → token
```

Hợp đồng adapter (đặt trong `packages/erp-adapters`):

```ts
type ErpUserProfile = { erpUserId: string; email: string; displayName: string };
type ErpAuthResult =
  | { ok: true; profile: ErpUserProfile }
  | { ok: false; reason: 'invalid_credentials' | 'inactive' | 'unavailable' };
interface ErpAuthAdapter { authenticate(username: string, password: string): Promise<ErpAuthResult>; }

type ProjectRole = 'viewer' | 'editor' | 'manager';
interface ErpRoleSource {
  listProjects(): Promise<{ projectKey: string; name: string }[]>;
  listProjectMembers(projectKey: string): Promise<{ email: string; role: ProjectRole }[]>;
  listUsers(): Promise<{ email: string; active: boolean }[]>;
}
```

- `sub`: `local:system_admin` hoặc `erp:<erpUserId>` (ổn định, không dùng email).
- Bảng (schema `bridge`): `oidc_payloads` (adapter), `accounts`, `login_attempts`, `auth_audit_log`.
- Adapter `stub`: đọc user từ file JSON dev. Adapter `none`: từ chối mọi user ERP (dùng cho production trước khi có ERP).
- Khóa: theo cặp (username, IP) 5 lần sai → khóa 15 phút, tăng dần. Không khóa cứng toàn cục theo username (tránh kẻ xấu khóa `system_admin`); thêm giới hạn chậm theo IP.

## Related Code Files

Tạo `packages/erp-adapters/`:
- `src/erp-auth-adapter.ts`, `src/erp-role-source.ts` (interface + type)
- `src/stub-erp-auth-adapter.ts`, `src/stub-erp-role-source.ts`
- `src/disabled-erp-auth-adapter.ts`
- `src/create-erp-adapters-from-env.ts`
- `dev-fixtures/stub-erp-users-and-projects.example.json`

Tạo `apps/oidc-bridge/`:
- `src/server.ts`
- `src/config/environment-config.ts` (validate bằng zod, fail nhanh)
- `src/provider/oidc-provider-configuration.ts`
- `src/provider/oidc-client-registry.ts`
- `src/provider/postgres-oidc-storage-adapter.ts`
- `src/provider/find-account-and-claims.ts`
- `src/interactions/login-interaction-routes.ts`
- `src/interactions/login-page-view.ts`
- `src/auth/authenticate-user-service.ts`
- `src/auth/local-system-admin-authenticator.ts`
- `src/auth/login-rate-limiter-and-lockout.ts`
- `src/audit/auth-audit-logger.ts`
- `src/health/health-check-route.ts`
- `scripts/generate-system-admin-password-hash.ts`
- `scripts/generate-signing-jwks.ts`
- `Dockerfile`

Tạo `packages/app-database/migrations/0002-create-bridge-tables.sql`.

Sửa: `infra/docker-compose.yml` (thêm service `oidc-bridge`), `infra/.env.example` (biến bridge + `OIDC_*` của Outline).

## Implementation Steps

1. `packages/erp-adapters`: interface, stub, disabled, factory. Factory từ chối `stub` khi `NODE_ENV=production`.
2. Migration 0002: 4 bảng schema `bridge`; index theo `expires_at`, `(username, ip)`.
3. `environment-config.ts`: issuer URL, cookie keys, JWKS, client outline (id, secret, redirect), `SYSTEM_ADMIN_USERNAME/EMAIL/PASSWORD_HASH`, `ERP_AUTH_ADAPTER`, timeout ERP.
4. Script sinh hash argon2id (nhập password qua stdin, không qua tham số dòng lệnh) và script sinh JWKS.
5. Storage adapter Postgres theo interface của `oidc-provider` (mẫu từ S7) + job dọn bản ghi hết hạn.
6. Cấu hình provider: client từ env, claim theo scope, bỏ consent cho client first-party (cách làm theo S7), TTL token/session, cookie keys.
7. `authenticate-user-service.ts`: rẽ nhánh local/ERP, bọc try/catch, luôn trả cùng một thông báo lỗi cho sai username và sai password.
8. Rate limit + lockout bằng bảng `login_attempts`; kiểm trước khi verify.
9. Interaction routes: GET form (CSRF token), POST login → `interactionFinished`. View HTML tối giản, không framework.
10. Audit log: thời điểm, username, kết quả, lý do, IP, user agent. Không ghi password.
11. Dockerfile + service compose; điền `OIDC_*` cho Outline (discovery hoặc khai tay theo S8).
12. Thiết lập admin Outline theo kết luận S2 (ghi vào `infra/README.md`).
13. Unit test: rẽ nhánh xác thực, lockout, factory adapter. Test tích hợp: login trọn luồng với Outline trong compose.

## Todo List

- [ ] `packages/erp-adapters` (interface, stub, disabled, factory)
- [ ] Migration bảng `bridge`
- [ ] Config env + script sinh hash + JWKS
- [ ] Storage adapter Postgres
- [ ] Cấu hình provider + client Outline
- [ ] Xác thực local `system_admin`
- [ ] Xác thực qua `ErpAuthAdapter` + timeout
- [ ] Rate limit / lockout
- [ ] Trang login + CSRF
- [ ] Audit log
- [ ] Docker + compose + env Outline
- [ ] `system_admin` thành admin Outline (theo S2)
- [ ] Unit + integration test

## Success Criteria

- `system_admin` login Outline thành công với `ERP_AUTH_ADAPTER=none` và khi adapter stub bị làm cho timeout.
- User stub login được, Outline tạo user đúng email/tên; login lần 2 không tạo trùng.
- 5 lần sai → bị khóa tạm; audit log có đủ bản ghi.
- Restart bridge: session + token còn hiệu lực (lưu Postgres), JWKS không đổi.
- Stub bị chặn ở production.

## Risk Assessment

- Bridge chết → không ai login. Giảm thiểu: healthcheck + restart policy; API key admin Outline cất offline làm break-glass (thao tác qua API); ghi runbook phase 7.
- Hiểu sai API `oidc-provider` → dựa PoC S7, giữ cấu hình trong 1 file.
- Đổi email phía ERP → user trùng trong Outline: xử lý theo S8, ghi vào runbook.
- Lộ `SYSTEM_ADMIN_PASSWORD_HASH`: argon2id chậm brute-force nhưng vẫn phải coi là secret.

## Security Considerations

- Argon2id m=19456, t=2, p=1 (OWASP). Password admin dài, sinh ngẫu nhiên.
- Thông báo lỗi login đồng nhất; không lộ username tồn tại hay không.
- CSRF cho form; cookie `httpOnly/secure/sameSite`; header bảo mật cơ bản.
- Redirect URI khớp tuyệt đối; client secret trong env.
- Audit log không chứa secret; log lỗi không in body request.
- Không có endpoint quản trị nào trong bridge (KISS, giảm bề mặt tấn công).

## Next Steps

- Phase 3 dùng `ErpRoleSource` stub.
- Phase 4: nếu fallback B (S5) → thêm client `companion` vào `oidc-client-registry.ts`.
- Phase 8: adapter `http` thật.
