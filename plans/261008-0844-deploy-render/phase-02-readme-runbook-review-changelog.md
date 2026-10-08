# Phase 02 — Runbook `infra/README.md` + review + changelog

## Context Links
- `infra/README.md` (thêm mục mới, không tạo file doc mới)
- `plans/reports/audit-261007-2222-deploy-setup-and-service-keys.md` (lệnh service key + scope)
- Phase 01: [phase-01-render-yaml.md](phase-01-render-yaml.md)

## Overview
- Priority: P2 · Status: pending · Effort: 1.5h
- Thêm mục **"Deploy lên Render (staging/test)"** vào `infra/README.md` (đặt sau mục Neon, trước "Cấu hình + branding Outline"). Sau đó code-review + changelog.

## Key Insights
- Thứ tự bootstrap giống luồng local, chỉ thay `localhost` bằng URL Render; các script chạy từ máy local trỏ vào URL Render / Neon.
- Migration app (`node-pg-migrate`) chạy qua endpoint Neon **direct**, idempotent → chạy lại để chắc (`No pending migrations.`).
- Mỗi lần đổi env trên dashboard Render tự redeploy service đó (docker runtime); service image (`hd-outline`) cũng redeploy khi đổi env, nhưng đổi image tag thì phải Manual Deploy (`autoDeploy` không áp dụng).

## Requirements — nội dung mục README (tiếng Việt, ngắn, cùng giọng văn file hiện tại)
1. **Phạm vi & giới hạn**: staging/test, free tier (spin-down 15', cold start), Neon + Upstash, URL `*.onrender.com`. **Known gap**: file đính kèm Outline lưu local trong container → mất khi redeploy/restart/spin-down; chưa có disk/S3 (việc sau).
2. **Bảng 3 service**: name, URL, health path (copy từ plan.md).
3. **Chuẩn bị giá trị** (từ `infra/.env` + `infra/.env.neon` local):
   - DB URL: `COMPOSE_OUTLINE_DATABASE_URL` → `DATABASE_URL` (hd-outline); `COMPOSE_BRIDGE_DATABASE_URL` → `BRIDGE_DATABASE_URL`; `COMPOSE_PERMISSION_API_DATABASE_URL` → `PERMISSION_API_DATABASE_URL` (tất cả pooler + `sslmode=require`).
   - `REDIS_URL` = Upstash `rediss://…`.
   - `BRIDGE_SIGNING_JWKS` + `OIDC_CLIENT_SECRET`: 2 lựa chọn — (a) chép y nguyên từ `.env` local (giữ continuity nếu Neon đã có phiên/`bridge.oidc_payloads` từ local); (b) sinh mới (test sạch, không user cũ). Đã chọn thì **giữ nguyên qua mọi lần deploy sau** (đổi = mọi user bị logout). `OIDC_CLIENT_SECRET` ở `hd-outline` và `hd-oidc-bridge` phải **giống hệt**.
   - Các secret còn lại chép từ `.env`: `OUTLINE_SECRET_KEY`→`SECRET_KEY`, `OUTLINE_UTILS_SECRET`→`UTILS_SECRET`, `BRIDGE_COOKIE_KEYS`, `SYSTEM_ADMIN_*`, `UPSTREAM_OIDC_*` (giữ nguyên issuer, không đổi domain IdP), `TOKEN_SEAL_PASSWORD`, SMTP (tùy).
   - Lưu ý: compose map `SMTP_USERNAME/PASSWORD/FROM_EMAIL` → permission-api `SMTP_USER/PASS/MAIL_FROM_EMAIL`; không dùng SMTP thì để unset, đừng nhập rỗng.
4. **Runbook bootstrap (đánh số)**:
   1. (Nếu chưa) migrate Neon bằng endpoint direct: `APP_DATABASE_URL=…direct…` → `pnpm --filter @hd-document/app-database migrate`.
   2. Render Dashboard → New → Blueprint → chọn repo/branch → nhập các biến `sync: false`. `OUTLINE_ADMIN_API_TOKEN` nhập placeholder `bootstrap-pending`; `PERMISSION_API_SERVICE_KEY`, `OUTLINE_OAUTH_CLIENT_ID/SECRET` để trống.
   3. Kiểm URL thật của 3 service trên dashboard = URL trong `render.yaml`; lệch (hậu tố) → sửa yaml, commit, sync lại.
   4. **[Thủ công, ngoài repo]** Thêm redirect URI `https://hd-oidc-bridge.onrender.com/upstream/callback` cho client `hd-dochub` ở IdP (issuer đang dùng trong `.env`). Giữ URI localhost nếu còn dev local.
   5. Đợi health xanh: `curl https://hd-oidc-bridge.onrender.com/healthz`, `.../_health` của Outline. Lần đầu Outline boot lâu (chạy migration nội bộ).
   6. Mở `https://hd-outline.onrender.com` → form `system_admin` → đăng nhập (Neon đã có admin từ local thì vào lại account đó).
   7. Outline Settings → API → tạo key → set `OUTLINE_ADMIN_API_TOKEN` trên `hd-permission-api` (Render tự redeploy).
   8. Từ máy local, export `OUTLINE_URL=https://hd-outline.onrender.com`, `OUTLINE_ADMIN_API_TOKEN`, `WORKSPACE_*`, `PERMISSION_API_PUBLIC_URL=https://hd-permission-api.onrender.com` → `apply-workspace-settings` rồi `register-oauth-client` (cập nhật redirect URI sang Render nếu client đã tồn tại từ local; tạo mới thì secret in 1 lần) → set `OUTLINE_OAUTH_CLIENT_ID/SECRET` trên `hd-permission-api`.
   9. Service key cho bridge: `PERMISSION_API_DATABASE_URL=<Neon direct, role permission_api_app>` → `pnpm --filter @hd-document/outline-permission-api manage-service-client create oidc-bridge --scopes users:write --project-keys "*"` → set `PERMISSION_API_SERVICE_KEY` trên `hd-oidc-bridge`. (Nếu Neon đã có client `oidc-bridge` từ local và còn giữ key cũ thì dùng lại.) Key cho erp-fake: chỉ khi erp-fake sẽ gọi permission-api trên Render (lệnh + scope trong audit report).
   10. Smoke test: SSO qua IdP với 1 user ERP → auto-provision (audit `autoProvisioned: true`); `curl https://hd-permission-api.onrender.com/healthz`.
5. **Vận hành staging**: nâng Outline image = sửa tag+digest trong cả compose và `render.yaml` rồi Manual Deploy `hd-outline`; xem log `auth_audit` qua tab Logs của `hd-oidc-bridge`; cold start lần đầu sau idle ~1 phút là bình thường.

## Architecture
Không đổi kiến trúc; mục README mô tả lại sơ đồ ở phase 01 bằng text ngắn.

## Related Code Files
- Modify: `infra/README.md`, `docs/project-changelog.md`
- Create/Delete: none

## Implementation Steps
1. Viết mục README theo Requirements (giữ gọn, ~80-110 dòng, dùng lại link tới mục Neon/branding hiện có thay vì chép lại — DRY).
2. Cập nhật dòng đầu README nếu cần (hiện ghi "chạy … local") → thêm 1 câu trỏ tới mục Render.
3. Delegate `code-reviewer`: review `render.yaml` + README diff (đủ biến, không secret, URL nhất quán, quote boolean/số).
4. Delegate `docs-manager`: thêm 1 dòng `docs/project-changelog.md`: "Added Render Blueprint (`render.yaml`) for staging deploy of outline, oidc-bridge, permission-api (Neon + Upstash)".
5. Commit conventional: `chore(infra): add Render blueprint for staging deploy` (chỉ khi user yêu cầu commit).

## Todo
- [ ] Mục "Deploy lên Render (staging/test)" trong `infra/README.md`
- [ ] Known gap file storage ghi rõ
- [ ] Bước thủ công IdP redirect URI ghi rõ
- [ ] code-reviewer review
- [ ] Changelog 1 dòng

## Success Criteria
- Người mới đọc README deploy được từ 0 tới SSO thành công không cần hỏi thêm.
- Phân biệt rõ biến nào nhập ở dashboard vs đã có trong yaml.
- code-reviewer không còn issue critical.

## Risk Assessment
| Risk | Mitigation |
|---|---|
| Quên đồng bộ `OIDC_CLIENT_SECRET` 2 service → Outline đăng nhập lỗi `invalid_client` | Ghi đậm trong README |
| Quên cập nhật redirect URI IdP → `idp_denied`/redirect_uri mismatch | Bước thủ công riêng, có câu kiểm |
| `register-oauth-client` chạy trên client cũ không cập nhật redirect → OAuth callback permission-api fail | Script cập nhật `redirectUris` khi client đã có (theo README hiện tại); ghi rõ |
| README phình to | Link tới mục sẵn có, không chép lại |

## Security Considerations
- README không chứa giá trị secret thật, chỉ tên biến.
- Lệnh service key chạy local với DB URL trong env shell, không lưu vào file commit.

## Next Steps
- Sau test ổn: kế hoạch riêng cho S3/R2 storage (fix gap), custom domain, cân nhắc nâng plan Outline/bridge khỏi free.
