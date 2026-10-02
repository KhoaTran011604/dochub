# Nhật ký dự án

## [2026-10-02] Bridge đăng nhập qua IdP thật (upstream OIDC)

**Status:** ✓ Hoàn thành  
**Scope:** `apps/oidc-bridge/src/upstream/`, env, test, phụ thuộc

### Đã thêm

- **Upstream OIDC login:** Bridge là relying party của IdP thật (https://idp.hdwebsoft.co, OpenIddict). Flow: `/interaction/:uid` → `/upstream/callback` với authorization code + PKCE S256.
- **Env mới:** `UPSTREAM_OIDC_ISSUER_URL`, `UPSTREAM_OIDC_CLIENT_ID`, `UPSTREAM_OIDC_CLIENT_SECRET` (tùy chọn; public client), `UPSTREAM_OIDC_SCOPES` (mặc định `openid profile email`).
- **Phụ thuộc:** `openid-client@^6.8.8`.
- **Files mới:** `src/upstream/{upstream-oidc-client.ts, upstream-login-transaction-cookie.ts, upstream-login-routes.ts}`.
- **Audit:** Event `upstream_login` (success / rejected: `transaction_missing`, `idp_denied`, `callback_invalid`, `idp_unavailable`, `unknown_user`, `deactivated`, `email_reserved_for_system_admin`).
- **Trang đăng nhập:** có IdP thì hiện nút "Đăng nhập SSO" (`GET /interaction/:uid/upstream`) + form `system_admin` bên dưới (break-glass khi IdP chết).
- **Test:** 7 integration test + 89 unit test pass.

### Đã sửa

- `ERP_SSO_*` + `/sso` route trở thành **tùy chọn** (khi có `UPSTREAM_OIDC_ISSUER_URL` hoặc `ERP_SSO_JWKS_URL`/`ERP_SSO_PUBLIC_KEY_PEM`).
- Config require ít nhất 1 path (upstream hoặc ERP key).
- `infra/README.md`: thêm mục "Đăng nhập qua IdP thật".

### Ghi chú

- Profile (email/name) từ `erp_users`, không từ IdP.
- User phải có trong `erp_users` (active) → link `/upstream/callback` → verify `id_token` (RS256, `iss`, `aud`, `exp`) → match `sub` với `erp_user_id` → sso_handoffs → finishLogin.
- Production reject HTTP upstream issuer; cookie `hd_upstream_login` (signed, httpOnly, lax, path `/upstream`, 10m, read-once).

## [2026-10-02] Nút "Đăng nhập qua ERP" trên form login của bridge

**Status:** ✓ Hoàn thành  
**Scope:** `apps/oidc-bridge` (login page), `infra/README.md`, erp-fake (repo riêng)

### Đã thêm

- Form "Đăng nhập quản trị" có thêm nút **Đăng nhập qua ERP** (chỉ hiện khi có `ERP_PORTAL_URL`) → `<ERP_PORTAL_URL>/sso/start?returnTo=<OUTLINE_URL>`. ERP render trang trung gian rồi `window.location` sang `/sso` của bridge để Referer đúng origin ERP.
- `buildErpSsoStartUrl` + unit test `login-page-view.test.ts`.
- erp-fake: `GET /sso/start` → `public/sso-start.html` (tự ký handoff nếu đã đăng nhập ERP, chưa thì đưa về login rồi quay lại).

### Đã sửa (erp-fake)

- `GET /api/projects/:id/documents` nằm nhầm trong router mount ở `/api/documents` → request rơi vào fallback `index.html`, frontend báo `Unexpected token '<'`. Chuyển handler sang `routes/projects.js`.

### Ghi nhận vận hành

- Seed user erp-fake phải dùng `_id` Mongo làm `--erp-user-id` (= `sub` trong JWT); id tự đặt → `unknown_user` → trang "chưa được cấp quyền".

## [2026-10-01] Đổi phạm vi: không tự viết UI, SSO làm trước

**Status:** Kế hoạch đã cập nhật, chưa có thay đổi code  
**Scope:** plan, phase files, roadmap  
**Nguồn:** [plan.md § Validation Log, Session 5](../plans/261001-0953-outline-plus-companion-document-system/plan.md)

### Thay đổi

- **Bỏ:** app web companion (Next.js, React, shadcn, TanStack Query, template → form → doc); form đăng nhập username/password kiểm qua ERP và `packages/erp-adapters`; AI gen; sync worker kéo quyền; adapter ERP thật.
- **Thêm:** SSO token handoff (ERP ký JWT ngắn hạn trong link, bridge verify, đăng nhập 1 click); `apps/outline-permission-api` headless (ERP đẩy user + quyền dự án / quyền từng node, tạo node doc dưới tên user thật); cấu hình + branding Outline bằng env và `team.update`.
- **Giữ:** Outline pin `1.10.1` + digest, không fork; `system_admin` local làm đường admin / break-glass; quy ước 1 dự án = 1 collection private + 3 group.
- **Schema DB:** `companion` sẽ đổi tên thành `permission_api` ở migration 0002 (schema đang rỗng); tách role DB cho từng service.

### Phase

- Đánh số lại (cũ → mới): 2 → 2 (viết lại) · 3 → 3 + 4 · 4 → 5 · 7 → 6 · 10 → 7 (hoãn) · 5, 8, 9 xóa. Mục phase 1 bên dưới ghi "phase 7" cho lịch backup + diễn tập restore: nay là phase 6.
- Effort: 240h (30 ngày công) cho phase 1-6, không còn dự phòng; trước đó MVP 1 30 ngày + MVP 2 ~19 ngày.

### Rủi ro đã ghi nhận

- Tác giả doc là user thật → mỗi user phải đồng ý 1 lần trong UI Outline; user chưa có phiên Outline cần mở link 2 lượt ở lần đầu. Đổi sang service account tiết kiệm ~30h (chờ user quyết).
- Trình duyệt đang giữ phiên Outline của user khác: bridge không xóa được (cookie host-only). Hạn chế đã chấp nhận, ghi runbook.
- Hợp đồng JWT với ERP chưa được xác nhận; dùng CLI dev ký JWT để phát triển và test.

## [2026-10-01] Phase 01: Monorepo & Hạ tầng Outline

**Status:** ✓ Hoàn thành  
**Scope:** Scaffolding workspace, Docker infra, database, backup  
**Validation:** [Tester report](../plans/reports/tester-261001-1419-phase-01-monorepo-and-outline-infra.md) · [Code review](../plans/reports/code-reviewer-261001-1419-phase-01-monorepo-and-outline-infra.md)

### Đã thêm

**Monorepo & build:**
- pnpm workspace (v10.30.2), Node 22.13.0+
- Root eslint + Prettier
- TypeScript 6.0.3, Vitest 5.0.3 với projects config
- CI workflow: lint, typecheck, test, format (GitHub Actions)

**App database package:**
- `@hd-document/app-database` (TS module)
- node-pg-migrate 9.0.0 (advisory lock, numeric prefix ordering)
- Migration 0001: schemas `bridge` + `companion` trong database `hd_document_apps`
- CLI: `pnpm --filter @hd-document/app-database migrate`

**Hạ tầng (Docker Compose):**
- Postgres 16 (Debian, ICU vi-VN) — Outline + app tách database
- Redis 7 (Outline cache)
- Outline 1.10.1 (pin digest, local file storage)
- Role isolation: role `outline` / `hd_document_apps`, CONNECT revoked từ PUBLIC

**Backup:**
- Script: dump 2 database Postgres (custom format) + tar.gz volume file đính kèm
- COMPLETE marker: thư mục backup hỏng nếu thiếu file này
- Chạy tay: `docker compose run --rm backup`

**Tài liệu hạ tầng:**
- `infra/README.md`: cách chạy lần đầu, dev migration, backup tay, quy định vận hành

### Quyết định & Deviations

- **Postgres Debian, không Alpine:** Alpine (musl) không hỗ trợ collation locale; đổi libc khi có dữ liệu làm hỏng text index.
- **Local file storage, không MinIO:** MinIO image chính thức không còn pull được.
- **Outline 1.10.1, không phải tag có PR #13879:** PR còn mở upstream, chưa release nào chứa (research ghi sai là đã merge).
- **`vitest.config.ts` (test.projects), không `vitest.workspace.ts`:** Vitest 5 đã bỏ file workspace.
- **TypeScript ~6.0, không 7:** typescript-eslint chưa hỗ trợ TS 7.
- Theo đúng plan: 1 Postgres instance, 2 database (`outline` chỉ Outline đụng, `hd_document_apps` cho app); backup mới chạy tay, lịch tự động + diễn tập restore ở phase 7.

### Hạn chế đã biết & Hoãn lại

**Hạn chế:**
- **Outline 1.10.1 chưa có bản vá PR #13879:** Move doc cha có share riêng → doc con mất quyền kế thừa. **Quy tắc:** không move doc đang có share riêng (documented ở infra/README.md).
- **Attachment upload chưa test:** Cần OIDC login → phase 2. Backup service test OK.
- **CI workflow chưa chạy trên GitHub:** Ready, chưa push.

**Deferred → Phase 2:**
- DB role isolation (W3): `bridge` + `companion` dùng chung role → companion bị khai thác thì đọc được secret của bridge. Quyết ở đầu phase 2, trước khi có dữ liệu thật.
- Production runtime path (W6): tsx, native type stripping, hay build step? Quyết khi viết Dockerfile.
- Type-aware lint (S2): `no-floating-promises` dành cho phase 2.

### Kiểm thử

- Vitest: 6/6 pass khi có `APP_DATABASE_URL` (Postgres thật); không có thì 4 pass, 2 test tích hợp migration bị skip.
- typecheck, lint, format:check: pass.
- Stack dựng từ volume trống: 3 service healthy, Outline trả HTTP 200.
- Migration chạy 2 lần: lần 2 không áp dụng gì.
- Backup tay: tester restore thử `hd_document_apps.dump` vào database tạm thành công.

Tiêu chí còn mở của phase 1: upload file đính kèm (kiểm ở phase 2 khi đã login được).

### File phải biết

- Monorepo: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.github/workflows/ci-lint-typecheck-test.yml`
- App database: `packages/app-database/`
- Hạ tầng: `infra/` (README, docker-compose.yml, .env.example, postgres-init, backup scripts)
