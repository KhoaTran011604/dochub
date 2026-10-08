# Audit: Deploy Setup & Permission API Service Keys

> Checked against actual code (`apps/outline-permission-api`, `apps/oidc-bridge`) + actual `infra/.env` (hd-document) and `.env` (erp-fake, sibling repo). Secrets are referenced by clientId only, never full value.

## 1. Tổng quan luồng

```
ERP (erp-fake) ──HD_PERMISSION_API_SERVICE_KEY──▶ outline-permission-api (:4100) ──admin token──▶ Outline
       │                                                      ▲
       │ ERP_SSO_ISSUER/JWT handoff                           │ PERMISSION_API_SERVICE_KEY (auto-provision user)
       ▼                                                      │
   oidc-bridge (:4001) ◀──IdP thật idp.dev.hdwebsoft.co────────┘
       │
       ▼
    Outline (:3000) — user đăng nhập qua bridge, không đăng nhập trực tiếp
```

2 service key độc lập, cả hai đều là 1 row trong `permission_api.service_clients`, chỉ khác tên/scope:

| Key | Ai dùng | Mục đích |
|---|---|---|
| `PERMISSION_API_SERVICE_KEY` | `oidc-bridge` (trong hd-document) | tự tạo user ERP ở lần SSO đầu (`PUT /users/{sub}`) |
| `HD_PERMISSION_API_SERVICE_KEY` | `erp-fake` (project ngoài) | push user, gán quyền collection/node, tạo doc, đọc cây tài liệu |

## 2. Lệnh sinh key + scope đúng

Chạy trong repo `hd-document`, cần `PERMISSION_API_DATABASE_URL` (role `permission_api_app`):

```sh
$env:PERMISSION_API_DATABASE_URL = "postgres://permission_api_app:<PERMISSION_API_DB_PASSWORD>@localhost:5432/hd_document_apps"

# oidc-bridge — chỉ cần users:write
pnpm --filter @hd-document/outline-permission-api manage-service-client create oidc-bridge `
  --scopes users:write --project-keys "*"

# erp-fake — cần đủ 4 scope (verify từ erp-fake/lib/hd-document-client.js + erp-fake/.env.example comment)
pnpm --filter @hd-document/outline-permission-api manage-service-client create erp-fake `
  --scopes users:write,permissions:write,documents:create,tree:read --project-keys "*"
```

Scope map (`apps/outline-permission-api/scripts/manage-service-client-key-cli.ts`, `docs/erp-integration-api-guide.md`):

| Scope | Cho phép |
|---|---|
| `users:write` | `/users/*` |
| `permissions:write` | `/projects/*`, `/documents/:id/members/*` |
| `documents:create` | `POST /documents` |
| `tree:read` | `GET /projects/{key}/document-tree` |

Key format: `hdk_<clientId 16 hex>_<secret 64 hex>` (`service-key-hashing.ts`). DB chỉ lưu SHA-256 hash của secret, không lưu secret → key chỉ in ra đúng 1 lần lúc `create`/`rotate`.

**Đối chiếu 2 key hiện có:**
- `PERMISSION_API_SERVICE_KEY` (hd-document) — clientId `5209866340b707aa`
- `HD_PERMISSION_API_SERVICE_KEY` (erp-fake) — clientId `95ecd163901057c4`

Cả 2 đúng format sinh từ CLI, clientId khác nhau → tách client đúng, không dùng chung key cho 2 hệ thống. `erp-fake/.env` có 2 dòng key cũ bị comment (1 dòng từng dùng nhầm clientId của bridge) — dòng đang active hiện tại đúng.

⚠️ **Chưa verify được trong DB** (Docker Desktop không chạy lúc audit). Khi stack `up`, chạy:

```sh
cd infra && docker compose exec -T postgres psql -U postgres -d hd_document_apps -c \
  "SELECT id, name, scopes, project_keys, revoked_at FROM permission_api.service_clients;"
```
Kỳ vọng: `id=5209866340b707aa, name=oidc-bridge, scopes={users:write}` và `id=95ecd163901057c4, name=erp-fake, scopes={users:write,permissions:write,documents:create,tree:read}`, cả 2 `revoked_at = NULL`.

## 3. Setup deploy — step by step

1. `pnpm install` → `cd infra && cp .env.example .env`
2. Điền secret hạ tầng bằng `openssl rand -hex 32`: `POSTGRES_PASSWORD`, `OUTLINE_DB_PASSWORD`, `APP_DB_PASSWORD`, `BRIDGE_DB_PASSWORD`, `PERMISSION_API_DB_PASSWORD`, `OUTLINE_SECRET_KEY`, `OUTLINE_UTILS_SECRET`, `OIDC_CLIENT_SECRET`, `BRIDGE_COOKIE_KEYS`.
3. `pnpm --filter @hd-document/oidc-bridge generate:signing-jwks` → dán `BRIDGE_SIGNING_JWKS`.
4. `printf '%s' '<mật khẩu>' | pnpm --filter @hd-document/oidc-bridge generate:admin-password-hash` → dán `SYSTEM_ADMIN_PASSWORD_HASH`.
5. `docker compose up -d --wait postgres` → từ root: `pnpm --filter @hd-document/app-database migrate` → `cd infra && docker compose up -d --wait --build`.
6. Đăng nhập Outline bằng `system_admin` → Settings → API → tạo `OUTLINE_ADMIN_API_TOKEN` → điền `.env`.
7. `pnpm --filter @hd-document/outline-workspace-setup apply-workspace-settings` (branding).
8. Điền `PERMISSION_API_PUBLIC_URL` → `pnpm --filter @hd-document/outline-workspace-setup register-oauth-client` → dán `OUTLINE_OAUTH_CLIENT_ID/SECRET` (in 1 lần).
9. Sinh 2 service key như mục 2 → dán `PERMISSION_API_SERVICE_KEY` (hd-document) và `HD_PERMISSION_API_SERVICE_KEY` (erp-fake).
10. Đăng ký client `hd-dochub` ở IdP: Redirect URI `<BRIDGE_PUBLIC_URL>/upstream/callback`, Consent = Implicit, scope openid+profile+email. erp-fake cũng dùng chung client `hd-dochub` để login nhân viên ERP → client ở IdP phải có **cả 2** redirect URI: `.../upstream/callback` (bridge) và `.../api/auth/oidc/callback` (erp-fake).
11. `docker compose up -d --build oidc-bridge outline-permission-api` lại để áp env mới.
12. `curl http://localhost:4100/healthz` + `curl http://localhost:4001/healthz`.

## 4. Vấn đề phát hiện trong `infra/.env` thật

| # | Vấn đề | Mức độ | Fix |
|---|---|---|---|
| 1 | `BRIDGE_DATABASE_URL` dùng password `postgres`, nhưng role `bridge_app` được tạo bằng `BRIDGE_DB_PASSWORD` (hex khác) | **Bug thật** — lệnh host dùng biến này (test tích hợp bridge, script host) sẽ auth fail | Sửa `BRIDGE_DATABASE_URL` khớp `BRIDGE_DB_PASSWORD` |
| 2 | `POSTGRES_PASSWORD`, `OUTLINE_DB_PASSWORD`, `APP_DB_PASSWORD` đều `= postgres` | Chỉ chấp nhận local dev | Generate lại bằng `openssl rand -hex 32` trước khi deploy thật; đổi role bằng `ALTER ROLE ... PASSWORD` (volume có data rồi không tự áp lại) |
| 3 | Mọi URL (`OUTLINE_URL`, `BRIDGE_PUBLIC_URL`, `PERMISSION_API_PUBLIC_URL`, `ERP_PORTAL_URL`, `SSO_ALLOWED_REFERRER_ORIGINS`) đều `localhost` | File hiện tại là cấu hình dev | Khi lên server thật: đổi sang domain public HTTPS, bật `OUTLINE_FORCE_HTTPS=true`, `BRIDGE_TRUST_PROXY=true`, `PERMISSION_API_TRUST_PROXY=true`, cập nhật redirect URI IdP + erp-fake đồng thời |
| 4 | `UPSTREAM_OIDC_ISSUER_URL=https://idp.dev.hdwebsoft.co` (IdP dev), prod có thể là `idp.hdwebsoft.co` | Cần confirm | Xác nhận domain IdP đúng trước go-live, đổi đồng bộ cả hd-document và erp-fake (hiện 2 bên đang nhất quán dùng domain dev) |
| 5 | `OUTLINE_RATE_LIMITER_REQUESTS=10000` (nới cho E2E) | Mất rate-limit bảo vệ nếu để ở prod | Hạ về mức hợp lý cho traffic thật |
| 6 | SMTP dùng Gmail cá nhân + app password | Giới hạn gửi/ngày, không hợp SLA prod | Xem xét SMTP provider riêng (SES/SendGrid/Mailgun) cho prod |

**Điểm tốt đã xác nhận:**
- `infra/.env` không bị track git, `.gitignore` có `.env`/`.env.*`.
- `PERMISSION_API_PUBLIC_URL` đã khớp `PERMISSION_API_HOST_PORT=4100` (lỗi 4002↔4100 trong doc cũ đã fix).
- `PERMISSION_API_DATABASE_URL` password khớp đúng `PERMISSION_API_DB_PASSWORD`.
- Cross-check hd-document ↔ erp-fake: `ERP_SSO_ISSUER`, `ERP_SSO_AUDIENCE`, `ERP_PORTAL_URL`↔`ERP_PUBLIC_URL`, `HD_PERMISSION_API_URL`↔`PERMISSION_API_PUBLIC_URL`, 2 service key — tất cả khớp nhau.

## 5. Checklist chạy ngon sau deploy

- [ ] Sửa bug #1 (`BRIDGE_DATABASE_URL`) trước khi chạy script host nào.
- [ ] Verify 2 service key `active` + đúng scope trong DB (SQL mục 2).
- [ ] Nếu deploy thật: đổi domain/HTTPS/trust-proxy (#3), rotate password yếu (#2), confirm IdP domain (#4).
- [ ] **Không rotate** `BRIDGE_SIGNING_JWKS` và `OIDC_CLIENT_SECRET` sau khi đã có user login — đổi là mọi user bị logout khỏi Outline.
- [ ] NTP đồng bộ giữa erp-fake và hd-document — lệch >30s làm handoff JWT bị từ chối.
- [ ] Backup tay trước khi đổi gì lớn: `docker compose run --rm backup`.
- [ ] Healthcheck 3 service: `/healthz` (bridge :4001, permission-api :4100), `/_health` (outline :3000).

## Unresolved questions

- Đây là deploy lên server production hay vẫn staging/dev? Cần domain công khai thật để chốt phần #3/#4 (reverse proxy, TLS, redirect URI IdP).
- IdP production là `idp.hdwebsoft.co` hay vẫn dùng `idp.dev.hdwebsoft.co` cho lần deploy này?
