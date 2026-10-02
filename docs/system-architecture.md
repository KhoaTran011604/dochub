# Kiến trúc hệ thống

## Tổng quan

Hệ thống gồm 3 thành phần chính:
- **Outline** (v1.10.1): nền tảng tài liệu, UI web
- **OIDC Bridge** (`apps/oidc-bridge`): cổng đăng nhập SSO + IdP relay
- **Permission API** (`apps/outline-permission-api`): quản lý quyền người dùng

Luồng: ERP → gọi API tạo node → link SSO → Bridge → login Outline → phân quyền

---

## Xác thực & cấp phép (Auth & Bridge)

### Đăng nhập người dùng

Bridge hỗ trợ **2 đường** để xác thực user:

#### 1. IdP thật (upstream OIDC) — **khuyến nghị, hiện tại**

- **Issuer:** https://idp.hdwebsoft.co (OpenIddict)
- **Flow:** Authorization Code + PKCE S256
- **Luồng chi tiết:**
  ```
  Browser → GET /interaction/:uid (no handoff cookie)
           → Bridge redirect → IdP /connect/authorize?code_challenge&state&nonce
           → User login ở IdP
           → IdP redirect → Bridge /upstream/callback?code&state
           → Bridge xác thực (verify id_token RS256 via jwks_uri)
           → Lookup erp_users by sub → sso_handoffs → finishLogin
  ```

- **Env vars:**
  | Biến | Ý nghĩa | Ví dụ |
  |------|---------|--------|
  | `UPSTREAM_OIDC_ISSUER_URL` | URL issuer IdP | `https://idp.hdwebsoft.co` |
  | `UPSTREAM_OIDC_CLIENT_ID` | Client ID tại IdP | `hd-dochub` |
  | `UPSTREAM_OIDC_CLIENT_SECRET` | Secret (tùy chọn; trống = public client) | — |
  | `UPSTREAM_OIDC_SCOPES` | Scope yêu cầu (mặc định) | `openid profile email` |
  | `BRIDGE_PUBLIC_URL` | URL công khai bridge (redirect URI tại IdP) | `https://bridge.example.com` |

- **Keying:** Transaction token (PKCE verifier, state, nonce) lưu cookie `hd_upstream_login` (signed, httpOnly, lax, path `/upstream`, 10 phút, read-once).

#### 2. ERP handoff (JWT token) — **tuỳ chọn, legacy**

- **Issuer:** ERP tự ký JWT ngắn hạn
- **Flow:** Browser GET `/sso?token=<jwt>` → Bridge verify JWKS/PEM → finishLogin
- **Env vars:**
  | Biến | Ý nghĩa |
  |------|---------|
  | `ERP_SSO_ISSUER` | Issuer claim JWT (e.g., `urn:erp:sso`) |
  | `ERP_SSO_JWKS_URL` | URL endpoint JWKS của ERP |
  | `ERP_SSO_PUBLIC_KEY_PEM` | Public key PEM (nếu không dùng JWKS) |

- **Requirement:** JWT phải có claim `jti` (sống ≤ 120s, verify 1 lần).

- **Trạng thái:** Khi `UPSTREAM_OIDC_ISSUER_URL` được set, `/sso` route là **tùy chọn**. Config yêu cầu ít nhất 1 path (upstream **hoặc** ERP key).

### Break-glass admin

- **Trang đăng nhập** `GET /interaction/:uid`: nút "Đăng nhập SSO" (→ `GET /interaction/:uid/upstream` → IdP) + form `system_admin` bên dưới. Không tự chuyển sang IdP.
- **Fallback:** IdP chết → nút SSO trả 503, form `system_admin` vẫn dùng được.

### Gating & permissions

- **Tất cả user (upstream + ERP)** phải có trong `permission_api.erp_users` (status `active`).
- **Email/name:** Từ `erp_users`, không từ IdP claims (tạm thời; có thể nới sau).
- **Audit:** Event `upstream_login` → success / rejected (reason: `transaction_missing`, `idp_denied`, `callback_invalid`, `idp_unavailable`, `unknown_user`, `deactivated`, `email_reserved_for_system_admin`).

---

## Database & schema

### `app-database`
- **Postgres** (v16): ICU locale vi-VN
- **Schemas:**
  - `bridge`: SSO handoffs, audit log
  - `companion` (→ `permission_api`): Users, projects, role grants
- **Migrations:** node-pg-migrate (numeric prefix)

### Key tables

| Table | Schema | Mục đích |
|-------|--------|---------|
| `sso_handoffs` | `bridge` | One-time token handoff (JWT jti hoặc UUID upstream) |
| `auth_audit_log` | `bridge` | Audit event (upstream_login, sso_login, admin_login) |
| `erp_users` | `companion` | User từ ERP (erp_user_id, email, status) |
| `projects` | `companion` | Dự án Outline |
| `role_grants` | `companion` | User → project quyền |

---

## Container & deployment

### Docker Compose
- **Postgres 16** (role isolation: `outline`, `hd_document_apps`)
- **Redis 7** (Outline cache)
- **Outline 1.10.1** (pin digest, local file storage)
- **OIDC Bridge** (Node.js, tsx runtime)
- **Permission API** (Node.js, tsx runtime, pending)

### Backup
- Custom dump Postgres + tar.gz volume
- Script: `docker compose run --rm backup`
- Restore testing: phase 6

---

## Dependency & library

### Bridge
- `openid-client@^6.8.8`: OIDC client (panva; discovery, PKCE, id_token verify)
- `jose`: JWT operations
- `zod`: Config validation
- `oidc-provider`: Test fixture (fake IdP)

### Database
- `node-pg-migrate@9.0.0`: Schema migrations

---

## Phụ lục: Follow-up items

- **Phase 3+:** Production hardening (HTTPS, TRUST_PROXY, IdP discovery cache invalidation).
- **Phase 4:** Provision `erp_users.erp_user_id` = IdP `sub` UUID.
- **Phase 4+:** Remove `/sso`, `ERP_SSO_*` khi upstream proven.
- **TBD:** Logout (end_session_endpoint callback); profile refresh (email/name từ IdP).
