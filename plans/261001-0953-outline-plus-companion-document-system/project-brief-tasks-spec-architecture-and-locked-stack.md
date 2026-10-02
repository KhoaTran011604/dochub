# Bảng tóm tắt kế hoạch triển khai hd-dochub

Bản tóm tắt 1 file của [plan.md](./plan.md) + các phase. Chi tiết (file cần tạo, bước làm, rủi ro) nằm ở từng phase; lệch nhau thì phase file là nguồn đúng.

- Ngày: 2026-10-01 (cập nhật theo Session 5) · 1 dev
- Ngân sách: 240h = 30 ngày công (đã xong 3, còn 27), không có dự phòng · hoãn: 2 ngày (API cây tài liệu)
- Không tự viết web UI. Sản phẩm = Outline (config + branding) + 2 service headless.

Mục lục: [1. Stack](#1-stack-dùng-để-build) · [2. Kiến trúc](#2-kiến-trúc) · [2.5 Source tree](#25-source-tree-tổng-thể) · [3. Spec](#3-spec) · [4. Công việc](#4-công-việc-cần-làm) · [5. Tiêu chí](#5-tiêu-chí-thành-công) · [6. Giả định](#6-giả-định--fallback-không-có-spike) · [7. Câu hỏi mở](#7-câu-hỏi-chưa-giải-quyết)

## 1. Stack dùng để build

1 sản phẩm có sẵn (Outline) + 2 service tự viết (bridge, permission API) + 3 package, tất cả TypeScript trong 1 monorepo, chạy bằng Docker Compose.

### 1.1 Nền tảng chung

| Hạng mục | Dùng | Ghi chú |
|---|---|---|
| Ngôn ngữ | TypeScript (strict) | `tsconfig.base.json` ở root |
| Runtime | Node.js 22 | `.nvmrc` pin tới minor; image chạy `node dist` (build bằng `tsc`) |
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`) | Không Turborepo |
| HTTP | Koa + `@koa/router` | Bridge buộc dùng Koa (`oidc-provider`); permission API dùng cùng framework |
| Validate | zod | Env (fail nhanh) + mọi input API |
| DB | `pg` + migration SQL (`node-pg-migrate`) | Không ORM |
| Unit / tích hợp | Vitest (`test.projects`) | Test quyền chạy với Outline thật, không mock |
| E2E | Playwright, đúng 2 spec | Chuỗi redirect SSO + chuỗi đồng ý OAuth (đi qua 3 origin + JS của Outline, `fetch` không mô phỏng được) |
| Lint / format | ESLint flat config type-aware + Prettier | |
| CI | GitHub Actions | install → format → typecheck → lint → unit; tích hợp + E2E theo yêu cầu |
| Đóng gói | Docker (mỗi app 1 `Dockerfile`) + Docker Compose | |

### 1.2 Stack theo từng thành phần

| Thành phần | Loại | Stack |
|---|---|---|
| Outline | Sản phẩm có sẵn | Image chính thức, pin `1.10.1` + digest, local file storage. Không fork; chỉ env + team settings |
| `apps/oidc-bridge` | Service Node | `oidc-provider` 9.x, `jose` (verify JWT ERP), `argon2`, `zod`, `pg`. 1 trang HTML thuần cho form `system_admin` |
| `apps/outline-permission-api` | Service Node headless | Koa, `zod`, `pg`, `iron-webcrypto` (niêm phong token). Không render trang nào |
| `packages/outline-api-client` | Thư viện | `fetch` có sẵn, timeout + retry 429/5xx + lỗi có kiểu |
| `packages/outline-workspace-setup` | CLI | 2 script idempotent: team settings, đăng ký OAuth client |
| `packages/app-database` | Thư viện + CLI | Pool factory + migration SQL |

### 1.3 Hạ tầng chạy (service trong compose)

| Service | Nguồn | Dùng cho |
|---|---|---|
| `outline` | Image pin tag + digest | Wiki, editor, quyền, file |
| `postgres` | Postgres 16 | 1 instance, 2 database: `outline` và `hd_document_apps` (schema `bridge`, `permission_api`). Role: `outline`, `hd_document_apps` (owner, chạy migration), `bridge_app`, `permission_api_app` |
| `redis` | Redis 7 | Chỉ Outline dùng |
| `oidc-bridge` | Build từ repo, port 4000 | IdP + SSO handoff |
| `outline-permission-api` | Build từ repo, port 4100 | API cho ERP + 2 route redirect cho trình duyệt |
| `backup` | Container chạy script | `pg_dump` 2 database + tar.gz file storage |
| Reverse proxy TLS | Chưa chốt | Chờ câu hỏi deploy |

### 1.4 Đã loại

Next.js · React · shadcn/ui · TanStack Query · `iron-session` · trang template/form · `packages/erp-adapters` · sync worker · AI gen (`@anthropic-ai/sdk`) · Turborepo · ORM · Redis cho app tự viết · magic link · tự viết crypto · fork Outline.

### 1.5 Version

Plan chỉ khóa: `oidc-provider` 9.x, Postgres 16, Redis 7, Outline `1.10.1`, Node 22. Còn lại lấy bản stable lúc dựng và khóa bằng lockfile.

### 1.6 Quyết định đã chốt qua validation

- Không tự viết UI; `apps/companion` bị thay bằng `apps/outline-permission-api`.
- SSO = token handoff 1 click (JWT do ERP ký). `system_admin` local là đường admin / break-glass.
- Quyền do ERP đẩy qua API; service áp ngay bằng admin token. Không có job kéo.
- Tác giả doc tạo qua API = user thật (token OAuth theo user).
- Break-glass khi bridge chết: API key admin Outline cất offline.
- Đã bỏ: phase spike, init bộ tài liệu dự án, template → form → doc, AI gen, sync worker, adapter ERP.

## 2. Kiến trúc

### 2.1 Ý tưởng

Outline lo toàn bộ wiki, editor, phân quyền, file. Phần tự viết bù đúng 2 chỗ:

1. **oidc-bridge**: cho user ERP vào Outline bằng 1 click, không mật khẩu; thêm 1 tài khoản `system_admin` local.
2. **outline-permission-api**: cửa duy nhất để ERP điều khiển Outline: provision user, cấp/thu quyền, tạo node doc.

Mọi việc soạn/sửa nội dung làm trong Outline. Không có màn hình nào của riêng ta ngoài form đăng nhập `system_admin`.

### 2.2 Sơ đồ tổng thể

```
                      service key
   ERP (server) ───────────────────────> outline-permission-api ──admin token──> Outline API
                  PUT users, projects,          │                                  (users, groups,
                  members; POST documents       │ token OAuth của user              collections, documents)
                                                └──────────────────────────────> documents.create

                  {bridge}/sso?token=<jwt>&returnTo=<url>
   ERP (trình duyệt) ──────────────────> oidc-bridge ──302──> Outline ──OIDC──> oidc-bridge ──> Outline (doc)
                                             │                                   (tự hoàn tất bằng handoff)
                                             └─ system_admin: form argon2id (không qua ERP)
```

### 2.3 Sơ đồ triển khai

```
docker compose (infra/)
├─ outline                 ──> postgres (db outline), redis, volume file-storage
├─ oidc-bridge             ──> postgres (db hd_document_apps: schema bridge; SELECT permission_api.erp_users)
├─ outline-permission-api  ──> postgres (schema permission_api), Outline API
├─ postgres, redis            (không publish port)
└─ backup                  ──> pg_dump + tar.gz file-storage theo lịch

Trình duyệt chạm: outline, oidc-bridge, outline-permission-api (chỉ /pending/*, /oauth/outline/callback).
ERP server chạm: outline-permission-api (/api/v1/*).
```

### 2.4 Thành phần và trách nhiệm

| Đường dẫn | Trách nhiệm | Phase |
|---|---|---|
| `apps/oidc-bridge` | IdP cho Outline, `/sso` handoff, form `system_admin`, lockout, audit | 2 |
| `apps/outline-permission-api` | Service key, user, dự án, cấp/thu quyền, tạo node, OAuth theo user, audit | 4, 5 |
| `packages/outline-api-client` | Nơi duy nhất gọi Outline API; nhận token từ caller | 3, 4, 5 |
| `packages/outline-workspace-setup` | Script team settings + đăng ký OAuth client | 3 |
| `packages/app-database` | Pool factory + migration SQL | 1 |
| `infra/` | Compose, env mẫu, init DB, backup/restore | 1, 6 |
| `tests/e2e` | 2 spec Playwright | 2, 5 |

Phụ thuộc giữa các gói:

```
oidc-bridge ─────────────> app-database
outline-permission-api ──> outline-api-client, app-database
outline-workspace-setup ─> outline-api-client
```

### 2.5 Source tree tổng thể

Không đánh dấu = phạm vi chính; `[hoãn]` = phase 7. Mỗi app/package có thêm `package.json` + `tsconfig.json`.

```
hd-document/
├─ package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.mjs  vitest.config.ts
├─ .nvmrc  .editorconfig  .gitattributes  .prettierignore  .gitignore
├─ .github/workflows/ci-lint-typecheck-test.yml
│
├─ apps/
│  ├─ oidc-bridge/                                   # phase 2
│  │  ├─ Dockerfile
│  │  ├─ scripts/
│  │  │  ├─ generate-system-admin-password-hash.ts
│  │  │  ├─ generate-signing-jwks.ts
│  │  │  └─ dev/
│  │  │     ├─ generate-dev-erp-signing-keypair.ts
│  │  │     ├─ sign-dev-sso-handoff-link.ts
│  │  │     └─ seed-dev-erp-user.ts
│  │  └─ src/
│  │     ├─ server.ts
│  │     ├─ config/environment-config.ts
│  │     ├─ provider/
│  │     │  ├─ oidc-provider-configuration.ts
│  │     │  ├─ oidc-client-registry.ts
│  │     │  ├─ postgres-oidc-storage-adapter.ts
│  │     │  ├─ find-account-and-claims.ts
│  │     │  └─ load-existing-grant-for-first-party-client.ts
│  │     ├─ sso/
│  │     │  ├─ sso-handoff-route.ts
│  │     │  ├─ verify-erp-handoff-token.ts
│  │     │  ├─ erp-public-key-resolver.ts
│  │     │  ├─ validate-return-to-url.ts
│  │     │  ├─ check-sso-request-referrer.ts
│  │     │  └─ sso-handoff-repository.ts
│  │     ├─ accounts/erp-user-directory-reader.ts
│  │     ├─ interactions/
│  │     │  ├─ login-interaction-routes.ts
│  │     │  └─ login-page-view.ts
│  │     ├─ auth/
│  │     │  ├─ local-system-admin-authenticator.ts
│  │     │  └─ login-rate-limiter-and-lockout.ts
│  │     ├─ audit/auth-audit-logger.ts
│  │     └─ health/health-check-route.ts
│  │
│  └─ outline-permission-api/                        # phase 4, 5
│     ├─ Dockerfile
│     ├─ scripts/manage-service-client-key-cli.ts
│     └─ src/
│        ├─ server.ts
│        ├─ config/environment-config.ts
│        ├─ http/
│        │  ├─ error-handling-middleware.ts
│        │  ├─ service-key-authentication-middleware.ts
│        │  ├─ in-memory-rate-limit-middleware.ts
│        │  └─ validate-request-with-zod.ts
│        ├─ service-clients/
│        │  ├─ service-client-repository.ts
│        │  └─ service-key-hashing.ts
│        ├─ users/
│        │  ├─ erp-user-repository.ts
│        │  ├─ upsert-erp-users-service.ts
│        │  ├─ set-erp-user-active-state-service.ts
│        │  └─ users-routes.ts
│        ├─ projects/
│        │  ├─ project-group-naming-convention.ts
│        │  ├─ project-collection-map-repository.ts
│        │  ├─ ensure-project-collection-and-groups.ts
│        │  ├─ set-project-member-role-service.ts
│        │  └─ projects-routes.ts
│        ├─ document-permissions/
│        │  ├─ resolve-document-project-scope.ts
│        │  ├─ set-document-member-permission-service.ts
│        │  └─ document-members-routes.ts
│        ├─ documents/                                        # phase 5
│        │  ├─ create-document-routes.ts
│        │  ├─ create-document-as-user-service.ts
│        │  └─ idempotency-key-repository.ts
│        ├─ outline-oauth/                                    # phase 5
│        │  ├─ outline-oauth-authorization-flow.ts
│        │  ├─ user-outline-grant-repository.ts
│        │  ├─ get-outline-access-token-for-user.ts
│        │  └─ seal-and-unseal-token.ts
│        ├─ pending/                                          # phase 5
│        │  ├─ pending-document-request-repository.ts
│        │  └─ pending-document-request-routes.ts
│        ├─ document-tree/                                    [hoãn]
│        ├─ audit/api-audit-logger.ts
│        └─ health/health-check-route.ts
│
├─ packages/
│  ├─ app-database/                                  # phase 1
│  │  ├─ src/ (create-postgres-pool.ts, run-migrations.ts, run-migrations-cli.ts, index.ts)
│  │  └─ migrations/
│  │     ├─ 0001-create-bridge-and-companion-schemas.sql                               # đã có
│  │     ├─ 0002-rename-companion-schema-and-create-bridge-and-erp-user-tables.sql     # phase 2
│  │     ├─ 0003-create-service-client-project-map-and-audit-tables.sql                # phase 4
│  │     └─ 0004-create-user-grant-pending-request-and-idempotency-tables.sql          # phase 5
│  │
│  ├─ outline-api-client/src/
│  │  ├─ index.ts  outline-http-client.ts  outline-api-errors.ts  outline-api-types.ts
│  │  ├─ team-api.ts  oauth-clients-api.ts                    # phase 3
│  │  ├─ users-api.ts  groups-api.ts  collections-api.ts  documents-api.ts   # phase 4
│  │  └─ auth-api.ts  oauth-token-api.ts                      # phase 5
│  │
│  └─ outline-workspace-setup/src/                   # phase 3
│     ├─ desired-workspace-settings.ts
│     ├─ apply-outline-workspace-settings-cli.ts
│     └─ register-outline-oauth-client-cli.ts
│
├─ infra/                                            # phase 1, bổ sung ở 2-6
│  ├─ docker-compose.yml  docker-compose.dev-ports.yml
│  ├─ docker-compose.production.yml                           # phase 6
│  ├─ .env.example  README.md
│  ├─ postgres-init/01-create-databases.sql
│  └─ backup/
│     ├─ backup-postgres-databases.sh  backup-outline-file-storage.sh
│     └─ restore-postgres-databases.sh  restore-outline-file-storage.sh  scheduled-backup-entrypoint.sh   # phase 6
│
├─ tests/e2e/
│  ├─ playwright.config.ts
│  ├─ sso-handoff-link-opens-document-as-erp-user.spec.ts     # phase 2
│  └─ create-node-pending-consent-flow.spec.ts                # phase 5
│
├─ docs/                                             # phase 6
│  ├─ deployment-guide.md  operations-runbook.md  erp-integration-guide.md
│  ├─ system-architecture.md  code-standards.md
│  └─ development-roadmap.md  project-changelog.md
│
└─ plans/
```

Unit test đặt cạnh code. Thư mục rỗng còn sót `packages/erp-adapters/` xóa ở phase 2.

### 2.6 Luồng chính

**A. SSO 1 click (user ERP)**

1. ERP (tại thời điểm click) ký JWT rồi chuyển trình duyệt tới `{bridge}/sso?token=<jwt>&returnTo=<url Outline>`.
2. Bridge: kiểm Referer → verify JWT → ghi `jti` (1 lần) → user có trong `erp_users` và active → `returnTo` thuộc allow-list → đặt cookie handoff, xóa session bridge cũ → 302 `returnTo`.
3. Outline chưa có phiên → nhớ path → tự chuyển `/auth/oidc` → bridge `/auth` → interaction thấy handoff → hoàn tất ngay, không hiện form.
4. Outline callback → user đứng ở đúng doc.

Outline đã có phiên: bước 3 không xảy ra, doc mở ngay bằng phiên đang có.

**B. `system_admin`**

Mở Outline → chuyển sang bridge → không có handoff → form username + password → argon2id verify → vào Outline. Không gọi ERP ở bước nào.

**C. ERP cấp quyền**

1. `PUT /api/v1/users/{erpUserId}` → user có trong Outline (invite không gửi mail) + dòng `erp_users`.
2. `PUT /api/v1/projects/{projectKey}` → collection private + 3 group.
3. `PUT /api/v1/projects/{projectKey}/members/{erpUserId}` hoặc `PUT /api/v1/documents/{documentId}/members/{erpUserId}`.
4. Có hiệu lực ngay; user thấy ở lần tải trang kế.

**D. ERP tạo node → user vào sửa (luồng nghiệm thu)**

1. `POST /api/v1/documents` (service key + `Idempotency-Key` + `actingErpUserId`).
2. User đã đồng ý trước đó → `201 { documentId, url }`. ERP bọc `url` bằng luồng A → 1 click vào sửa.
3. Chưa → `202 { pendingUrl }`. ERP bọc `pendingUrl` bằng luồng A → Outline hiện màn đồng ý → 1 click → doc được tạo dưới tên user → chuyển tới doc.
4. ERP gửi lại cùng `Idempotency-Key` để lấy `documentId` khi cần.

**E. Soạn tay trong Outline**

User có role `editor`/`manager` của dự án (hoặc `read_write` trên node) → New doc / sửa trực tiếp. Không qua service nào của ta.

### 2.7 Token nào dùng ở đâu

| Token | Ai giữ | Dùng để | Không được |
|---|---|---|---|
| JWT handoff | ERP ký, đi qua URL 1 lần | Đăng nhập 1 click | Sống > 60s, dùng lại, vào log |
| Khóa ký JWT (private) | ERP | Ký handoff | Rời ERP. Bridge chỉ có public key |
| Service key | ERP; ta lưu dạng băm | Gọi `/api/v1/*`, giới hạn theo dự án + scope | Đọc nội dung doc |
| Admin API token Outline | Env của permission API + script setup | Provision user, cấp/thu quyền, team settings | Tạo doc thay user; xuống trình duyệt; vào log |
| Token OAuth Outline theo user | Permission API, niêm phong trong DB | `documents.create` dưới tên user | Rời server; scope rộng hơn `documents:create auth:read` |
| OIDC client secret (`outline`) | Env Outline + bridge | Outline đổi code lấy token | |
| API key admin break-glass | Cất offline | Thao tác Outline khi bridge chết | Vận hành thường ngày |

### 2.8 Dữ liệu tự quản (database `hd_document_apps`)

| Schema | Bảng | Phase |
|---|---|---|
| `bridge` | `oidc_payloads`, `sso_handoffs`, `login_attempts`, `auth_audit_log` | 2 |
| `permission_api` | `erp_users` (bridge chỉ `SELECT`) | 2 |
| `permission_api` | `service_clients`, `project_collection_map`, `api_audit_log` | 4 |
| `permission_api` | `user_outline_grants`, `pending_document_requests`, `idempotency_keys` | 5 |

Schema `permission_api` là schema `companion` của migration 0001 đổi tên ở 0002 (đang rỗng). Nội dung tài liệu, user, group, quyền: nằm trong database `outline`; app tự viết không đọc/ghi trực tiếp. Ta không lưu bản sao membership.

### 2.9 Nguyên tắc xuyên suốt

- Outline là nguồn sự thật về quyền và là nơi ép quyền.
- Danh tính: `sub` = `erp:<erpUserId>` hoặc `local:system_admin`. Email/tên chỉ đến từ API provision (có service key), không từ trình duyệt.
- Bridge luôn phát `email_verified: true` (Outline chỉ khớp account đã invite khi email verified).
- Provision trước, SSO sau: user không có trong `erp_users` thì không vào được; Outline bật `inviteRequired` làm lớp chặn thứ hai.
- Mọi endpoint ghi của permission API idempotent; đổi quyền theo thứ tự fail closed.
- Không bao giờ suspend / hạ quyền `system_admin`.
- Bridge chỉ phụ thuộc Postgres, không có endpoint quản trị.

## 3. Spec

### 3.1 Link SSO (hợp đồng với ERP)

```
GET {bridge}/sso?token=<JWT>&returnTo=<URL đã encode>
→ 302 returnTo            (đã đặt handoff; hoặc không đặt nếu token hỏng nhưng returnTo hợp lệ)
→ 400 / 401 text + link ERP (returnTo sai, thiếu Referer hợp lệ)
```

| JWT | Giá trị |
|---|---|
| Header | `alg: ES256` (RS256 nếu ERP cần), `kid`, `typ: JWT` |
| `iss` | định danh ERP (env `ERP_SSO_ISSUER`) |
| `aud` | `hd-document-sso` (env `ERP_SSO_AUDIENCE`) |
| `sub` | erpUserId ổn định, không phải email |
| `iat`, `exp` | `exp - iat` ≤ 60s |
| `jti` | UUID, dùng 1 lần |

- Khóa: ERP công bố JWKS URL (xoay bằng `kid`) hoặc đưa PEM public key.
- ERP ký tại thời điểm click (endpoint ERP redirect), không nhúng link ký sẵn vào trang/email.
- Link không dùng `rel=noreferrer`; trang ERP không đặt `Referrer-Policy: no-referrer`.
- `returnTo`: URL Outline, hoặc `pendingUrl` do API trả. Không gì khác.
- JWT không mang email/tên. User phải được provision trước (mục 3.2).
- ERP logout nên điều hướng qua `{outline}/logout` để hai phiên không lệch nhau.

Form `system_admin`: username + hash argon2id từ env (m=19456, t=2, p=1); khóa theo (username, IP) 5 lần sai → 15 phút tăng dần + giới hạn theo IP; thông báo lỗi đồng nhất; CSRF.

Claim bridge phát cho Outline: `sub`, `email`, `email_verified: true`, `name`, `preferred_username`.

### 3.2 Permission API

Chung: `Authorization: Bearer <service key>`; JSON; lỗi `{ error: { code, message } }`; mọi PUT/DELETE gọi lại an toàn.

```
PUT    /api/v1/users/{erpUserId}                         { email, name }        → 200 { erpUserId, outlineUserId, status }
POST   /api/v1/users/batch-upsert                        { users[≤20] }         → 200 { results[] }
POST   /api/v1/users/{erpUserId}/deactivate                                     → 200
POST   /api/v1/users/{erpUserId}/activate                                       → 200
PUT    /api/v1/projects/{projectKey}                     { name }               → 200 { projectKey, collectionId, url }
PUT    /api/v1/projects/{projectKey}/members/{erpUserId} { role }               → 200      role: viewer | editor | manager
DELETE /api/v1/projects/{projectKey}/members/{erpUserId}                        → 204
PUT    /api/v1/documents/{documentId}/members/{erpUserId} { permission }        → 200      permission: read | read_write
DELETE /api/v1/documents/{documentId}/members/{erpUserId}                       → 204
```

Mã lỗi: 400 input · 401 key sai · 403 ngoài scope / ngoài dự án / đụng `system_admin` · 404 · 409 email trùng user khác · 429 (kèm `Retry-After`) · 502 Outline lỗi.

- 1 dự án = 1 collection private + 3 group `<projectKey>-viewer|editor|manager` (quyền `read | read_write | admin`). 1 user có đúng 1 role trong 1 dự án.
- Quyền mức node: user thấy node đó + node con.
- Service key: scope `users:write`, `permissions:write`, `documents:create`; danh sách `projectKey` được phép hoặc `*`.
- Nạp user ban đầu: dùng batch (Outline giới hạn 20 invite/request, 50 request/giờ).

### 3.3 Quy ước dự án

- `projectKey`: `^[a-z0-9][a-z0-9-]{1,40}$`.
- Group do API quản; không gán tay. Admin sửa tay trong Outline sẽ bị lần PUT kế của ERP ghi đè (riêng user đó).
- Quy tắc vận hành: không move doc đang có share riêng (Outline `1.10.1` chưa có bản vá PR #13879).

### 3.4 API tạo node

```
POST /api/v1/documents
Authorization: Bearer <service key>     Idempotency-Key: <bắt buộc>
{ projectKey, actingErpUserId, title, text, parentDocumentId?, publish? = true }
→ 201 { documentId, url }
→ 202 { requestId, pendingUrl, expiresAt }
→ 400 | 401 | 403 | 404 | 409 (cùng key khác body) | 429 | 502
```

- `url` = URL doc Outline thuần. **ERP tự bọc thành `{bridge}/sso?token=…&returnTo=<url>`** rồi mới đưa cho user. `pendingUrl` bọc y hệt.
- `201`: user đã có grant; doc tạo bằng token của user; quyền do Outline ép.
- `202`: user chưa đồng ý. Mở `pendingUrl` → màn đồng ý của Outline → 1 click → doc được tạo → chuyển tới doc. Hết hạn sau 7 ngày. Chỉ đúng user đó hoàn tất được.
- Gửi lại cùng `Idempotency-Key` + cùng body → trạng thái hiện tại; không bao giờ tạo doc thứ 2.
- Hạn chế đã biết: lần đầu mà user chưa có phiên Outline → lượt mở đầu chỉ đăng nhập, mở lại link mới thấy màn đồng ý.

### 3.5 Cấu hình + branding Outline

- Env: chỉ OIDC, không đặt `OIDC_DISABLE_REDIRECT`, `OIDC_DISPLAY_NAME`, `DEFAULT_LANGUAGE`, không SMTP, tắt đăng ký OAuth client động.
- Team settings qua `team.update` (script idempotent): tên, logo, màu nhấn, `publicBranding`; tắt `sharing`, `guestSignin`, `passkeysEnabled`, `memberCollectionCreate`, `memberTeamCreate`, `membersCanInvite`, `membersCanCreateApiKey`, `membersCanDeleteAccount`, `mcp`; bật `inviteRequired`; `defaultUserRole: member`. Bảng đầy đủ + trạng thái xác nhận ở phase 3.
- Không gỡ hết được chữ "Outline" khi không fork.

### 3.6 Hoãn

`GET /api/v1/projects/{projectKey}/document-tree?actingErpUserId=` → cây `{ id, title, url, parentDocumentId, children[] }`. Xem phase 7.

### 3.7 Phi chức năng chung

- File code < 200 dòng, tên kebab-case mô tả rõ. 1 middleware lỗi bọc mọi handler; lỗi không lộ chi tiết nội bộ.
- Không secret trong git/log/image; `.env.example` đầy đủ. Postgres/Redis không publish port.
- Token (JWT handoff, service key, admin token, token OAuth) không bao giờ vào log.
- Permission API chạy 1 instance (rate limit trong bộ nhớ).
- Chạy được trên Windows + Linux (`.gitattributes` ép LF cho `infra/**/*.sh`).

## 4. Công việc cần làm

Thứ tự: 1 → 2 → 3 → 4 → 5 → 6. Mỗi phase thử giả định rủi ro nhất ở ngày đầu.

**[Phase 1](./phase-01-monorepo-and-outline-infra.md): Monorepo + hạ tầng Outline (3 ngày)** — ✓ DONE

- [x] Root workspace + tsconfig + eslint + vitest.config.ts
- [x] docker compose (postgres, redis, outline pin, local file storage)
- [x] Init database + role (REVOKE CONNECT)
- [x] `.env.example` đủ biến
- [x] `packages/app-database` + migration 0001 + subpath export
- [x] Script backup Postgres + file storage (tar.gz)
- [x] CI workflow (format:check, typecheck, lint, test, timeout)
- [x] `infra/README.md`
- [x] Kiểm tra từ volume trống

**[Phase 2](./phase-02-oidc-bridge-sso-token-handoff-and-local-system-admin.md): OIDC bridge + SSO handoff + system_admin (8,5 ngày)**

- [ ] Việc hoãn phase 1 (role DB, runtime image, lint type-aware, hostname, CI)
- [ ] Ngày 1: login trọn luồng + kiểm 4 giả định
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

**[Phase 3](./phase-03-outline-config-branding-and-api-client.md): Cấu hình + branding Outline, API client (3 ngày)**

- [ ] `outline-api-client`: http client + lỗi có kiểu
- [ ] Ngày 1: thử `team.update` + `oauthClients.create` bằng API key admin
- [ ] `team-api`, `oauth-clients-api`
- [ ] Script áp team settings (idempotent)
- [ ] Script đăng ký OAuth client (idempotent)
- [ ] Env Outline: ngôn ngữ, chỉ OIDC, tắt DCR
- [ ] Kiểm bằng mắt từng setting + README
- [ ] Unit + integration test

**[Phase 4](./phase-04-permission-layer-api-users-projects-and-grants.md): Permission API (7 ngày)**

- [ ] Client: users, groups, collections, documents (permission)
- [ ] Ngày 1: invite → cấp quyền → SSO lần đầu
- [ ] Khung app + Dockerfile + compose
- [ ] Migration 0003
- [ ] Service key: auth, scope, phạm vi dự án, CLI
- [ ] Rate limit, giới hạn body, audit
- [ ] Users: upsert, batch, deactivate, activate
- [ ] Projects: collection + 3 group
- [ ] Cấp/thu role dự án
- [ ] Cấp/thu quyền mức node
- [ ] Integration test quyền với Outline thật
- [ ] Nháp tài liệu API

**[Phase 5](./phase-05-create-node-api-with-real-user-authorship.md): API tạo node, tác giả thật (5,5 ngày)**

- [ ] Ngày 1: thử OAuth Outline trọn vòng + refresh + hành vi khi chưa có phiên
- [ ] Client: `documents.create`, `auth.info`, token
- [ ] Migration 0004
- [ ] Idempotency + `documentId` sinh trước
- [ ] Niêm phong token, grant, refresh có khóa
- [ ] Nhánh 201
- [ ] Nhánh 202: lưu yêu cầu, `/pending/:id`, callback, kiểm danh tính, hết hạn
- [ ] Deactivate → thu hồi grant
- [ ] Integration test
- [ ] Playwright: chuỗi đồng ý

**[Phase 6](./phase-06-testing-hardening-operations-docs.md): Rà bảo mật, backup, runbook, tài liệu ERP (3 ngày)**

- [ ] Chạy lại toàn bộ test trên compose sạch
- [ ] Rà bảo mật + vá mức cao
- [ ] Backup theo lịch + diễn tập restore
- [ ] Compose production override
- [ ] Runbook, tài liệu tích hợp ERP, deployment guide, system architecture, code standards
- [ ] Roadmap + changelog

**Hoãn:** [Phase 7](./phase-07-deferred-third-party-document-tree-api.md) API cây tài liệu (2 ngày).

## 5. Tiêu chí thành công

- **Luồng chính:** gọi API tạo node → link → bọc SSO → 1 click → user đứng trong doc mới ở Outline, sửa được, tác giả là chính user. Chạy được bằng CLI dev trước khi phía ERP có.
- SSO không mật khẩu, không thấy màn login; token replay / hết hạn / sai chữ ký không đăng nhập được.
- `system_admin` login được khi không có ERP.
- Cấp role dự án hoặc quyền 1 node → user thấy và sửa được đúng phần đó, không thấy gì ngoài; thu quyền / deactivate có hiệu lực ngay.
- Outline hiện đúng tên, logo, ngôn ngữ; chỉ còn đường đăng nhập qua bridge.
- Restore từ backup lên máy sạch thành công.

## 6. Giả định + fallback (không có spike)

| Phase | Giả định (thử ngày đầu) | Sai thì |
|---|---|---|
| 2 | `oidc-provider`: `interactionFinished` + `loadExistingGrant` đủ để login không form | Tự tạo grant trong interaction; thư viện không dùng được → dừng, báo user |
| 2 | Outline tự chuyển sang OIDC, giữ deep link (đã đọc source) | 1 nút bấm thêm; user mở lại link |
| 2 | `email_verified: true` → khớp account đã invite | Bỏ pre-provision, user tạo ở lần login đầu |
| 2 | Outline nhận issuer/callback HTTP ở local | Reverse proxy TLS tự ký |
| 3 | API key admin gọi được `team.update`, `oauthClients.create` | Đặt tay trong Settings, ghi runbook |
| 4 | `users.invite` + `suppressEmail` chạy không SMTP | User tạo ở lần SSO đầu; cấp quyền trước đó trả `409` |
| 4 | Quyền mức node đủ để mở + sửa doc và doc con | Yêu cầu kèm role dự án `viewer` |
| 5 | OAuth của Outline chạy trên self-host, refresh dùng offline được | Tác giả = service account (−30h) hoặc headless; dừng, hỏi user |
| 5 | Mất màn đồng ý khi chưa có phiên (đã đọc source) | Chấp nhận 2 lượt lần đầu; chung domain thì đặt cookie `postLoginRedirectPath` |

Quá 2 ngày chưa qua được giả định đầu của phase 2 hoặc phase 5 → dừng, báo user.

## 7. Câu hỏi chưa giải quyết

1. Hợp đồng JWT với ERP: thuật toán, phân phối khóa, claim định danh, `iss`/`aud`, ai dựng link và lúc nào, có giữ được `Referer` không.
2. Domain / TLS: ERP, bridge, Outline, permission API có chung registrable domain không; ai cấp cert; đã có reverse proxy chưa.
3. ERP có đảm bảo `erpUserId` ổn định không tái sử dụng, email unique + đã xác minh + user không tự sửa tùy ý không.
4. Tác giả thật hay service account (lần đầu chưa có phiên cần 2 lượt; service account tiết kiệm ~30h).
5. Lệch phiên Outline trên trình duyệt dùng chung: chấp nhận hạn chế hay cần ép đăng nhập lại (+1 ngày).
6. Nơi deploy; permission API chỉ mở nội bộ được không.
7. SMTP: chạy không email có chấp nhận được không.
8. Số user nạp đầu (giới hạn ~1000 user/giờ).
9. Quyền mức node có cần `admin` không.
10. Frontmatter `branch` của plan (`develop`) lệch nhánh thật (`feat/phase-1-new`).
