# Bảng tóm tắt kế hoạch triển khai hd-dochub

Bản tóm tắt 1 file của [plan.md](./plan.md) + các phase. Chi tiết (file cần tạo, bước làm, rủi ro) nằm ở từng phase; lệch nhau thì phase file là nguồn đúng.

- Ngày: 2026-10-01 · Branch: `develop` · 1 dev
- Ngân sách MVP 1: 30 ngày công (29 + 1 dự phòng) · MVP 2: ~19 ngày công (hoãn)

Mục lục: [1. Stack](#1-stack-dùng-để-build) · [2. Kiến trúc](#2-kiến-trúc) · [2.5 Source tree](#25-source-tree-tổng-thể) · [3. Spec](#3-spec) · [4. Công việc](#4-công-việc-cần-làm) · [5. Tiêu chí](#5-tiêu-chí-thành-công) · [6. Giả định](#6-giả-định-chưa-kiểm-chứng-không-có-spike) · [7. Câu hỏi mở](#7-câu-hỏi-chưa-giải-quyết)

## 1. Stack dùng để build

Hệ thống gồm 1 sản phẩm có sẵn (Outline) + 2 app tự viết (bridge, companion) + 4 package dùng chung, tất cả TypeScript trong 1 monorepo, chạy bằng Docker Compose.

### 1.1 Nền tảng chung

| Hạng mục | Dùng | Ghi chú |
|---|---|---|
| Ngôn ngữ | TypeScript (strict) | `tsconfig.base.json` ở root, mỗi package extends |
| Runtime | Node.js | Version theo `engines` của `oidc-provider` 9.x, ghi vào `.nvmrc` |
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`) | Không Turborepo |
| Validate | zod | Env config (fail nhanh), input API, schema form |
| Unit / tích hợp | Vitest (workspace) | Test phân quyền chạy với Outline thật, không mock |
| E2E | Playwright | Chạy trên compose đầy đủ + ERP stub |
| Lint / format | ESLint flat config + Prettier mặc định | |
| CI | GitHub Actions | install → typecheck → lint → test; E2E chạy theo yêu cầu |
| Đóng gói | Docker (mỗi app 1 `Dockerfile`) + Docker Compose | |

### 1.2 Stack theo từng thành phần

| Thành phần | Loại | Stack |
|---|---|---|
| Outline | Sản phẩm có sẵn, self-host | Image chính thức, pin tag stable có PR #13879 + digest. Không sửa code, không build từ `main` |
| `apps/oidc-bridge` | Service Node độc lập | `oidc-provider` 9.x (chạy trên Koa), `argon2`, `zod`, `pg`. Trang login là HTML thuần, không framework frontend |
| `apps/companion` | Web app + BFF | Next.js (App Router, route handlers), React, shadcn/ui (Radix UI + Tailwind CSS), react-hook-form, zod, TanStack Query, `iron-session`, `pg` |
| `apps/permission-sync-worker` (MVP 2) | Worker Node | Vòng lặp + cờ CLI, Postgres advisory lock |
| `packages/outline-api-client` | Thư viện | `fetch` có sẵn của Node, tự bọc timeout + retry 429/5xx + lỗi có kiểu. Không thêm thư viện HTTP |
| `packages/erp-adapters` | Thư viện | TypeScript thuần: interface + stub (đọc file JSON) + `none`; adapter `http` ở MVP 2 |
| `packages/project-permission-sync` | Thư viện + CLI | TypeScript thuần, CLI Node |
| `packages/app-database` | Thư viện + CLI | `pg` (pool factory) + `node-pg-migrate`, migration viết SQL thuần. Không ORM |
| AI gen (MVP 2, trong companion) | Module | `@anthropic-ai/sdk` với `baseURL` trỏ Claude proxy; model từ env `AI_MODEL_ID` (mặc định `claude-opus-5-5`) |

### 1.3 Hạ tầng chạy (service trong compose)

| Service | Image / nguồn | Dùng cho |
|---|---|---|
| `outline` | Outline (pin tag + digest) | Wiki, editor, quyền, file |
| `postgres` | Postgres 16+ | 1 instance, 2 database: `outline` (của Outline) và `hd_document_apps` (schema `bridge`, `companion`). Role riêng cho từng database |
| `redis` | Redis 7 | Chỉ Outline dùng. App tự viết không dùng Redis |
| `minio` + `minio-init` | MinIO (S3) | File đính kèm của Outline. Fallback: lưu local volume |
| `oidc-bridge` | Build từ repo | IdP |
| `companion` | Build từ repo | Web app + endpoint bên thứ 3 |
| `backup` | Container chạy script | `pg_dump` 2 database + `mc mirror` bucket, theo lịch |
| Reverse proxy TLS | Chưa chốt | Chỉ thêm nếu Outline đòi HTTPS cho issuer/callback; production chờ câu hỏi deploy |

### 1.4 Đã loại (không dùng)

Turborepo · ORM · Redis cho app tự viết · editor trong companion · magic link · tự viết crypto/mã hóa (token/JWKS do `oidc-provider`, hash do `argon2`, niêm phong do `iron-session`) · gọi `api.anthropic.com` trực tiếp.

### 1.5 Version

Plan chỉ khóa: `oidc-provider` 9.x, Postgres 16+, Redis 7, Outline (tag có PR #13879). Các version còn lại (Node cụ thể, Next.js, React, TanStack Query, Tailwind…) chưa pin trong plan: lấy bản stable lúc dựng phase 1 / phase 4 và khóa bằng `.nvmrc` + lockfile.

### 1.6 Quyết định đã chốt qua validation

- User thường chờ ERP: trước phase 8, production chạy `ERP_AUTH_ADAPTER=none` (chỉ `system_admin`). Stub chỉ cho dev/test, bị chặn ở production.
- Companion đăng nhập bằng OAuth của Outline (không làm OIDC client của bridge trừ khi fallback).
- Break-glass khi bridge chết: API key admin Outline cất offline.
- Doc tạo qua endpoint bên thứ 3 ghi tác giả là user ERP thật (grant OAuth theo user), không dùng admin token.
- Admin token chỉ dùng ở CLI đăng ký dự án (phase 3) và job sync (phase 9).
- Proxy Claude theo định dạng Anthropic Messages API.
- Đã bỏ: phase spike, tính năng init bộ tài liệu dự án.

## 2. Kiến trúc

### 2.1 Ý tưởng

Outline lo toàn bộ wiki, editor, phân quyền, file. Phần tự viết chỉ bù 2 chỗ Outline không có:

1. **oidc-bridge**: cho Outline đăng nhập bằng tài khoản ERP (và 1 tài khoản `system_admin` local dùng được khi ERP down).
2. **companion**: tạo doc chuẩn từ template qua form, và mở endpoint cho ERP tạo doc.

Template **không bắt buộc**. Có 3 cách tạo doc, cả 3 đều ra doc Outline bình thường và chịu cùng một bộ quyền:

| Cách | Làm ở đâu | Dùng khi |
|---|---|---|
| Soạn tay bằng editor | Outline (New doc trong collection/doc cha có quyền ghi) | Doc tự do, ghi chú, nội dung không có mẫu |
| Template → form | Companion, xong mở link sang Outline | Doc chuẩn cần style đồng nhất |
| API | Endpoint bên thứ 3 của companion (`templateId + values` hoặc `text` thô) | ERP tạo node doc |

Companion không có editor: soạn template, soạn tay, sửa doc sau khi tạo đều làm trong Outline.

### 2.2 Sơ đồ tổng thể (MVP 1)

```
                 (1) mở wiki                 (2) OIDC login
   Browser ───────────────────> Outline ───────────────────> oidc-bridge
      │                            ▲                             │
      │                            │                             ├─ system_admin: argon2 verify (local)
      │ (3) tạo doc từ template    │ Outline API                 └─ user ERP: ErpAuthAdapter ──> ERP
      │                            │ (token của user)                         (stub; thật ở MVP 2)
      └──────────────────────> companion
                                   ▲
   ERP ── service key ─────────────┘  POST /api/v1/external/documents
          + actingUserEmail

   register-project CLI ── admin token ──> Outline API   (tạo collection + 3 group cho 1 dự án)
```

MVP 2 thêm: `permission-sync-worker ── ErpRoleSource ──> Outline API (admin token)` và `companion ──> Claude proxy`.

### 2.3 Sơ đồ triển khai

```
docker compose (infra/)
├─ outline        ──> postgres (db outline), redis, minio
├─ oidc-bridge    ──> postgres (db hd_document_apps, schema bridge)
├─ companion      ──> postgres (db hd_document_apps, schema companion), Outline API
├─ postgres, redis, minio   (không publish port ra ngoài mạng docker)
└─ backup         ──> pg_dump + mc mirror theo lịch

Mở ra ngoài: outline, oidc-bridge, companion.
```

### 2.4 Thành phần và trách nhiệm

| Đường dẫn | Trách nhiệm | Phase |
|---|---|---|
| `apps/oidc-bridge` | IdP cho Outline: form login, `system_admin` local, gọi `ErpAuthAdapter`, lockout, audit | 2 |
| `apps/companion` | Login bằng OAuth Outline, template → form → doc, endpoint bên thứ 3 | 4 |
| `apps/permission-sync-worker` | Reconcile quyền ERP → group Outline | 9 (MVP 2) |
| `packages/outline-api-client` | Nơi duy nhất gọi Outline API; nhận token từ caller | 3, 4 |
| `packages/erp-adapters` | `ErpAuthAdapter` (`stub` / `none` / `http`), `ErpRoleSource` | 2, 9, 8 |
| `packages/project-permission-sync` | Quy ước collection + group, CLI đăng ký dự án, logic sync | 3, 9 |
| `packages/app-database` | Pool factory + migration SQL | 1 |
| `infra/` | Compose, env mẫu, init DB/MinIO, backup/restore | 1, 7 |
| `tests/e2e` | Playwright trên compose đầy đủ | 7 |

Phụ thuộc giữa các gói:

```
oidc-bridge ──> erp-adapters, app-database
companion ────> outline-api-client, app-database
register-project CLI / sync-worker ──> project-permission-sync ──> outline-api-client, app-database, erp-adapters
```

### 2.5 Source tree tổng thể

Gom từ mục "Related Code Files" của các phase. Không đánh dấu = MVP 1; `[MVP 2]` = làm sau. Mỗi app/package có thêm `package.json` + `tsconfig.json` riêng (không liệt kê).

```
hd-document/
├─ package.json                      # private, scripts typecheck|lint|test gọi pnpm -r
├─ pnpm-workspace.yaml               # apps/*, packages/*
├─ tsconfig.base.json
├─ eslint.config.mjs
├─ vitest.workspace.ts
├─ .nvmrc  .editorconfig  .gitattributes  .gitignore
├─ .github/workflows/
│  └─ ci-lint-typecheck-test.yml
│
├─ apps/
│  ├─ oidc-bridge/                                   # phase 2
│  │  ├─ Dockerfile
│  │  ├─ scripts/
│  │  │  ├─ generate-system-admin-password-hash.ts
│  │  │  └─ generate-signing-jwks.ts
│  │  └─ src/
│  │     ├─ server.ts
│  │     ├─ config/environment-config.ts
│  │     ├─ provider/
│  │     │  ├─ oidc-provider-configuration.ts
│  │     │  ├─ oidc-client-registry.ts
│  │     │  ├─ postgres-oidc-storage-adapter.ts
│  │     │  └─ find-account-and-claims.ts
│  │     ├─ interactions/
│  │     │  ├─ login-interaction-routes.ts
│  │     │  └─ login-page-view.ts
│  │     ├─ auth/
│  │     │  ├─ authenticate-user-service.ts
│  │     │  ├─ local-system-admin-authenticator.ts
│  │     │  └─ login-rate-limiter-and-lockout.ts
│  │     ├─ audit/auth-audit-logger.ts
│  │     └─ health/health-check-route.ts
│  │
│  ├─ companion/                                     # phase 4
│  │  ├─ Dockerfile
│  │  ├─ app/
│  │  │  ├─ login/page.tsx
│  │  │  ├─ (app)/
│  │  │  │  ├─ templates/page.tsx
│  │  │  │  ├─ templates/[id]/new/page.tsx
│  │  │  │  ├─ templates/[id]/ai/page.tsx                    [MVP 2, phase 5]
│  │  │  │  ├─ pending/[id]/page.tsx
│  │  │  │  └─ grant/page.tsx                                [MVP 2, phase 10]
│  │  │  └─ api/
│  │  │     ├─ auth/outline/login/route.ts
│  │  │     ├─ auth/outline/callback/route.ts
│  │  │     ├─ auth/outline/logout/route.ts
│  │  │     ├─ templates/route.ts
│  │  │     ├─ templates/[id]/route.ts
│  │  │     ├─ collections/route.ts
│  │  │     ├─ collections/[id]/document-tree/route.ts
│  │  │     ├─ documents/route.ts
│  │  │     ├─ ai/generate-document-draft/route.ts           [MVP 2, phase 5]
│  │  │     └─ v1/external/
│  │  │        ├─ documents/route.ts
│  │  │        ├─ projects/[projectKey]/document-tree/route.ts  [MVP 2, phase 10]
│  │  │        └─ role-changed/route.ts                      [MVP 2, phase 8, tùy chọn]
│  │  ├─ components/
│  │  │  ├─ dynamic-placeholder-form.tsx
│  │  │  ├─ document-destination-picker.tsx
│  │  │  ├─ ai-streaming-draft-preview.tsx                   [MVP 2, phase 5]
│  │  │  ├─ context-document-picker.tsx                      [MVP 2, phase 5]
│  │  │  └─ ui/                                              # shadcn
│  │  ├─ lib/
│  │  │  ├─ config/environment-config.ts
│  │  │  ├─ auth/
│  │  │  │  ├─ outline-oauth-flow.ts
│  │  │  │  ├─ user-session-repository.ts
│  │  │  │  ├─ require-user-session.ts
│  │  │  │  └─ get-outline-client-for-user.ts
│  │  │  ├─ templates/
│  │  │  │  ├─ placeholder-parser.ts
│  │  │  │  ├─ placeholder-field-types.ts
│  │  │  │  ├─ build-form-schema-from-placeholders.ts
│  │  │  │  └─ merge-template-with-values.ts
│  │  │  ├─ documents/create-document-from-template-service.ts
│  │  │  ├─ external/
│  │  │  │  ├─ service-client-authenticator.ts
│  │  │  │  ├─ idempotency-key-repository.ts
│  │  │  │  ├─ user-outline-grant-repository.ts
│  │  │  │  ├─ pending-document-request-repository.ts
│  │  │  │  └─ load-project-document-tree-for-user.ts        [MVP 2, phase 10]
│  │  │  ├─ audit/companion-audit-logger.ts
│  │  │  └─ ai/                                              [MVP 2, phase 5]
│  │  │     ├─ claude-proxy-client.ts
│  │  │     ├─ build-document-generation-prompt.ts
│  │  │     ├─ context-document-loader.ts
│  │  │     ├─ ai-usage-repository.ts
│  │  │     ├─ ai-daily-quota-guard.ts
│  │  │     └─ map-claude-error-to-user-message.ts
│  │  └─ queries/
│  │     ├─ query-keys.ts
│  │     ├─ templates/queries.ts
│  │     ├─ collections/queries.ts
│  │     ├─ documents/mutations.ts
│  │     └─ ai/mutations.ts                                  [MVP 2, phase 5]
│  │
│  └─ permission-sync-worker/                        [MVP 2, phase 9]
│     ├─ Dockerfile
│     └─ src/
│        ├─ worker-main.ts
│        └─ environment-config.ts
│
├─ packages/
│  ├─ app-database/                                  # phase 1
│  │  ├─ src/
│  │  │  ├─ create-postgres-pool.ts
│  │  │  └─ run-migrations-cli.ts
│  │  └─ migrations/
│  │     ├─ 0001-create-bridge-and-companion-schemas.sql
│  │     ├─ 0002-create-bridge-tables.sql                               # phase 2
│  │     ├─ 0003-create-project-collection-map-table.sql                # phase 3
│  │     ├─ 0004-create-companion-session-and-external-request-tables.sql  # phase 4
│  │     └─ (kế tiếp: sync_runs/sync_actions, AI usage)      [MVP 2]
│  │
│  ├─ erp-adapters/                                  # phase 2
│  │  ├─ dev-fixtures/stub-erp-users.example.json
│  │  └─ src/
│  │     ├─ erp-auth-adapter.ts
│  │     ├─ stub-erp-auth-adapter.ts
│  │     ├─ disabled-erp-auth-adapter.ts
│  │     ├─ create-erp-adapters-from-env.ts
│  │     ├─ erp-role-source.ts                               [MVP 2, phase 9]
│  │     ├─ stub-erp-role-source.ts                          [MVP 2, phase 9]
│  │     ├─ erp-http-client.ts                               [MVP 2, phase 8]
│  │     ├─ http-erp-auth-adapter.ts                         [MVP 2, phase 8]
│  │     ├─ http-erp-role-source.ts                          [MVP 2, phase 8]
│  │     └─ map-erp-role-to-project-role.ts                  [MVP 2, phase 8]
│  │
│  ├─ outline-api-client/                            # phase 3, mở rộng ở phase 4
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ outline-http-client.ts
│  │  │  ├─ outline-api-types.ts
│  │  │  ├─ collections-api.ts
│  │  │  ├─ groups-api.ts
│  │  │  ├─ documents-api.ts                                 # phase 4
│  │  │  ├─ auth-api.ts                                      # phase 4
│  │  │  ├─ oauth-token-api.ts                               # phase 4
│  │  │  └─ users-api.ts                                     [MVP 2, phase 9]
│  │  └─ contract-tests/                                     [MVP 2, phase 7b]
│  │
│  └─ project-permission-sync/                       # phase 3
│     └─ src/
│        ├─ project-group-naming-convention.ts
│        ├─ ensure-project-collection-and-groups.ts
│        ├─ project-collection-map-repository.ts
│        ├─ register-project-cli.ts
│        ├─ compute-membership-diff.ts                       [MVP 2, phase 9]
│        ├─ reconcile-project-memberships.ts                 [MVP 2, phase 9]
│        ├─ reconcile-suspended-users.ts                     [MVP 2, phase 9]
│        ├─ reconcile-all-projects.ts                        [MVP 2, phase 9]
│        ├─ sync-safety-threshold-guard.ts                   [MVP 2, phase 9]
│        └─ sync-run-repository.ts                           [MVP 2, phase 9]
│
├─ infra/                                            # phase 1, bổ sung ở phase 7
│  ├─ docker-compose.yml
│  ├─ docker-compose.production.yml                          # phase 7
│  ├─ .env.example
│  ├─ README.md
│  ├─ postgres-init/01-create-databases.sql
│  ├─ minio-init/create-outline-bucket.sh
│  └─ backup/
│     ├─ backup-postgres-databases.sh
│     ├─ backup-minio-bucket.sh
│     ├─ restore-postgres-databases.sh                       # phase 7
│     ├─ restore-minio-bucket.sh                             # phase 7
│     └─ scheduled-backup-entrypoint.sh                      # phase 7
│
├─ tests/e2e/                                        # phase 7
│  ├─ playwright.config.ts
│  ├─ fixtures/seed-outline-test-data.ts
│  ├─ system-admin-login-when-erp-down.spec.ts
│  ├─ companion-never-leaks-unreadable-documents.spec.ts
│  ├─ parent-share-exposes-only-branch.spec.ts
│  └─ template-to-document-flow.spec.ts
│
├─ docs/                                             # phase 7
│  ├─ deployment-guide.md
│  ├─ operations-runbook.md
│  ├─ third-party-document-api.md
│  ├─ development-roadmap.md
│  └─ project-changelog.md
│
└─ plans/                                            # plan + phase + research + reports
```

Unit test đặt cạnh code trong từng app/package (viết ngay trong phase đó); `tests/e2e` chỉ chứa E2E.

### 2.6 Luồng chính

**A. Đăng nhập Outline**

1. User mở Outline → Outline redirect sang bridge (authorization code flow).
2. Bridge hiện form username + password.
3. Username = `SYSTEM_ADMIN_USERNAME` → so hash argon2id từ env. Khác → `ErpAuthAdapter.authenticate` (có timeout).
4. Bridge upsert `bridge.accounts`, trả code → Outline đổi token, lấy claim (`sub`, `email`, `name`, `preferred_username`) → tạo/khớp user.

**B. Tạo doc từ template (companion)**

1. User login companion bằng OAuth app của Outline → companion lưu token Outline (niêm phong) trong `companion.user_sessions`, trình duyệt chỉ giữ cookie session.
2. Companion liệt kê template (doc con của `Mẫu tài liệu`) bằng token user.
3. Dò placeholder `{{ten:kieu}}` → sinh form động → user điền, chọn collection/parent.
4. Merge → `documents.create` bằng token user → trả link mở trong Outline.

**C. ERP tạo doc qua endpoint bên thứ 3**

1. ERP gọi `POST /api/v1/external/documents` với service key + `Idempotency-Key` + `actingUserEmail`.
2. Companion kiểm key, kiểm `projectKey` được phép, tra `project_collection_map` → `collectionId`.
3. Có grant của user đó → tạo doc bằng token user → `201 { documentId, url }`.
4. Chưa có grant → lưu yêu cầu chờ → `202 { pendingUrl }`; user mở link, login companion, doc được tạo dưới tên user.

**D. Soạn tay trong Outline (không qua companion, không cần code)**

1. User login Outline (luồng A), vào collection dự án.
2. Thuộc group `editor` hoặc `manager` → New doc (hoặc doc con dưới 1 doc cha) → gõ trực tiếp bằng editor của Outline.
3. Group `viewer` chỉ đọc, không tạo/sửa được.
4. Doc tạo từ luồng B, C sau đó cũng sửa tiếp bằng editor này.

### 2.7 Token nào dùng ở đâu

| Token | Ai giữ | Dùng để | Không được dùng ở |
|---|---|---|---|
| Token Outline của user (OAuth) | Companion, niêm phong trong DB | Mọi thao tác của user, kể cả endpoint bên thứ 3 | Không xuống trình duyệt, không log |
| Admin API token Outline | Env của CLI (và worker ở MVP 2) | Đăng ký dự án, sync quyền | Bất kỳ route nào của companion |
| Service key của ERP | ERP; companion lưu dạng băm | Gọi endpoint bên thứ 3, giới hạn theo `projectKey` | Đọc nội dung doc |
| API key admin break-glass | Cất offline | Thao tác Outline qua API khi bridge chết | Vận hành thường ngày |

### 2.8 Dữ liệu tự quản (database `hd_document_apps`)

| Schema | Bảng | Phase |
|---|---|---|
| `bridge` | `oidc_payloads`, `accounts`, `login_attempts`, `auth_audit_log` | 2 |
| `companion` | `project_collection_map` | 3 |
| `companion` | `user_sessions`, `user_outline_grants`, `pending_document_requests`, `external_idempotency_keys`, `companion_audit_log` | 4 |
| `companion` | `sync_runs`, `sync_actions`, bảng AI usage | 9, 5 (MVP 2) |

Nội dung tài liệu, user, group, quyền: nằm trong database `outline`, app tự viết không đọc/ghi trực tiếp.

### 2.9 Nguyên tắc xuyên suốt

- Quyền do Outline ép: mọi thao tác của user dùng token của chính user. Companion không tự kiểm quyền.
- Bridge là điểm chết duy nhất của đăng nhập: giữ nhỏ, chỉ phụ thuộc Postgres, không có endpoint quản trị.
- Nhánh xác thực `system_admin` không gọi ERP ở bất kỳ bước nào.
- `sub` ổn định: `local:system_admin` hoặc `erp:<erpUserId>`, không dùng email.
- Mọi thay đổi khi có ERP thật gói trong `packages/erp-adapters` + env.

## 3. Spec

### 3.1 Đăng nhập (oidc-bridge)

- Authorization code flow cho client `outline` (confidential, `client_secret_basic`, redirect `{outline}/auth/oidc.callback`).
- 1 form username + password. `system_admin`: username + hash argon2id từ env (m=19456, t=2, p=1). User khác: `ErpAuthAdapter.authenticate`, chọn bằng env `stub | none | http`.
- Claim: `sub`, `email`, `name`, `preferred_username`.
- Khóa tạm theo cặp (username, IP): 5 lần sai → 15 phút, tăng dần; thêm giới hạn theo IP. Không khóa toàn cục theo username.
- Thông báo lỗi đồng nhất, CSRF cho form, cookie `httpOnly/secure/sameSite=lax`, audit mọi lần login, `/healthz`.
- ERP chậm/down: timeout ngắn, báo lỗi rõ cho user ERP, không ảnh hưởng `system_admin`.

```ts
type ErpUserProfile = { erpUserId: string; email: string; displayName: string };
type ErpAuthResult =
  | { ok: true; profile: ErpUserProfile }
  | { ok: false; reason: 'invalid_credentials' | 'inactive' | 'unavailable' };
interface ErpAuthAdapter { authenticate(username: string, password: string): Promise<ErpAuthResult>; }
```

### 3.2 Quy ước dự án

- 1 dự án = 1 collection private + 3 group `<projectKey>-viewer|editor|manager` (đọc / đọc-ghi / quản lý).
- Đăng ký bằng CLI `--project-key --name`, idempotent, ghi `project_collection_map`.
- Collection `Templates` (mọi thành viên đọc được) + doc gốc `Mẫu tài liệu`; doc con = template.
- MVP 1: gán thành viên vào group bằng tay trong Outline. MVP 2: job sync ghi đè theo ERP.

### 3.3 Companion: template → form → doc

- Login/logout qua OAuth app Outline (authorization code + PKCE nếu có, refresh có khóa hàng).
- Liệt kê template user đọc được. Placeholder `{{ten:kieu}}`, kiểu: `text` (mặc định), `longtext`, `number`, `date`, `select(a|b|c)`. Trùng tên = 1 field.
- Form động + validate → merge (không để sót `{{...}}`) → `documents.create` → trả link Outline.
- Chọn đích: collection có quyền ghi + cây doc chọn parent. Deep link `?collectionId=&parentDocumentId=`.
- Ngoài phạm vi companion: editor, tạo doc trống, sửa nội dung doc. Các việc này làm trong Outline (luồng D mục 2.6). Hệ thống không ép mọi doc phải qua template; doc soạn tay không được đảm bảo theo style chuẩn.

### 3.4 Endpoint bên thứ 3

```
POST /api/v1/external/documents
Authorization: Bearer <service key>   Idempotency-Key: <bắt buộc>
{ projectKey, actingUserEmail, parentDocumentId?, title, templateId?, values?, text?, publish? }
→ 201 { documentId, url } | 202 { pendingUrl } | 400 | 401 | 403 | 409 | 429
```

- Có grant của `actingUserEmail` → tạo ngay bằng token user (`201`). Chưa có / hết hạn → lưu yêu cầu chờ, trả `202 pendingUrl`; chỉ đúng user đó hoàn tất được, hết hạn sau 7 ngày.
- Service key: lưu dạng băm, giới hạn theo `projectKey`, chỉ được tạo (không đọc), xoay vòng được, audit cả service client lẫn `actingUserEmail`.

MVP 2 (phase 10):

```
GET /api/v1/external/projects/{projectKey}/document-tree?actingUserEmail=&parentDocumentId?=
→ 200 cây { id, title, url, parentDocumentId, children[] } | 409 { grantUrl } | 403
```

Chỉ trả id, tiêu đề, link. Scope key tách riêng `documents:create` và `tree:read`.

### 3.5 MVP 2

- Phase 9, sync quyền: reconcile 3 group mỗi dự án theo `ErpRoleSource` (chu kỳ mặc định 5 phút), suspend user `active=false`, ngưỡng an toàn, advisory lock, `--once | --dry-run | --project | --confirm-large-change`. Không bao giờ suspend `system_admin`.
- Phase 8, ERP thật: `HttpErpAuthAdapter` + `HttpErpRoleSource`, map role qua config, webhook tùy chọn. Bị chặn tới khi có contract ERP.
- Phase 5, AI gen: template + form + doc ngữ cảnh (đọc bằng token user) → stream bản nháp → user duyệt → tạo doc. Cờ `AI_GENERATION_ENABLED` mặc định tắt, hạn mức theo user, ghi usage.

### 3.6 Phi chức năng chung

- File code < 200 dòng, tên kebab-case mô tả rõ. try/catch ở mọi route handler, lỗi không lộ chi tiết nội bộ.
- Không secret trong git/log/image; `.env.example` đầy đủ. Postgres/Redis/MinIO không publish port ra ngoài mạng docker.
- Frontend: query key tập trung 1 file (`queries/query-keys.ts`), mỗi domain 1 thư mục `queries.ts` + `mutations.ts`, hook dùng generic, hook mutation chỉ invalidate cache (toast/redirect qua callback), 1 component form động dùng chung.
- Chạy được trên Windows + Linux (`.gitattributes` ép LF cho `infra/**/*.sh`).

## 4. Công việc cần làm

### MVP 1 (thứ tự: 1 → 2 → 3 → 4 → 7)

**[Phase 1](./phase-01-monorepo-and-outline-infra.md): Monorepo + hạ tầng Outline (3 ngày)**

- [ ] Root workspace + tsconfig + eslint + vitest
- [ ] docker compose (postgres, redis, minio, outline pin)
- [ ] Init database + role
- [ ] `.env.example` đủ biến
- [ ] `packages/app-database` + migration 0001
- [ ] Script backup Postgres + MinIO
- [ ] CI workflow
- [ ] `infra/README.md`
- [ ] Kiểm tra từ volume trống

**[Phase 2](./phase-02-oidc-bridge-local-system-admin-erp-adapter-stub.md): OIDC bridge + system_admin + ERP stub (8 ngày)**

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
- [ ] `system_admin` thành admin Outline + upload thử file
- [ ] Unit + integration test

**[Phase 3](./phase-03-project-conventions-and-permission-sync-job.md): Outline API client + quy ước dự án (2 ngày)**

- [ ] `outline-api-client` (http client + collections/groups)
- [ ] Migration bảng mapping
- [ ] Quy ước tên group + map role
- [ ] `ensure-project-collection-and-groups`
- [ ] CLI đăng ký dự án
- [ ] Collection `Templates` + doc gốc
- [ ] Unit + integration test

**[Phase 4](./phase-04-companion-auth-template-form-third-party-endpoint.md): Companion (13 ngày)**

- [ ] Đăng ký OAuth app Outline
- [ ] Mở rộng `outline-api-client` (documents, `auth.info`, token)
- [ ] Migration bảng companion
- [ ] Luồng login/logout + session + refresh
- [ ] Parser placeholder + test
- [ ] Schema form + merge + test
- [ ] Route handlers (template, collection, document)
- [ ] UI danh sách template + form động + chọn đích
- [ ] Query keys tập trung + hooks
- [ ] Endpoint bên thứ 3 + idempotency + audit
- [ ] Grant theo user + tạo doc dưới tên user ERP (201)
- [ ] Yêu cầu chờ + trang `pendingUrl` (202) + hết hạn
- [ ] Integration test phân quyền
- [ ] Docker + compose

**[Phase 7](./phase-07-testing-hardening-operations-docs.md): Test cốt lõi, backup, runbook, docs (3 ngày)**

- [ ] Seed dữ liệu test
- [ ] E2E: `system_admin` login khi ERP down
- [ ] E2E: companion không lộ doc ngoài quyền
- [ ] E2E: share cha chỉ lộ nhánh con
- [ ] E2E: template → doc
- [ ] Rà soát bảo mật nhanh + vá mức cao
- [ ] Backup theo lịch
- [ ] Diễn tập restore, ghi runbook
- [ ] Compose production override
- [ ] Docs: deployment guide, runbook (break-glass), API bên thứ 3, roadmap, changelog

### MVP 2 (hoãn; thứ tự: 9 → 8 → 10 → 5 → 7b)

| Phase | Việc chính | Effort |
|---|---|---|
| [9](./phase-09-permission-sync-worker.md) Sync quyền | `ErpRoleSource` + stub, API users/group membership, diff thuần, reconcile + suspend, ngưỡng an toàn + advisory lock, worker, test | 4 ngày |
| [8](./phase-08-deferred-real-erp-auth-and-role-adapters.md) ERP thật (blocked) | Rà contract, `HttpErpAuthAdapter`, `HttpErpRoleSource` + map role, dry-run sync dữ liệu thật, chuyển user tránh trùng, webhook tùy chọn | 4 ngày (±) |
| [10](./phase-10-third-party-document-tree-api.md) API cây tài liệu | Scope service key, client lấy cây collection, service nạp cây theo user, route + rate limit + audit, trang cấp grant, test phân quyền | 2 ngày |
| [5](./phase-05-ai-generation-via-claude-proxy.md) AI gen | Thử proxy + chốt tham số, `claude-proxy-client`, prompt cache được, nạp ngữ cảnh bằng token user, route stream + abort + usage, UI preview, cờ + hạn mức | 5 ngày |
| [7b](./phase-07-testing-hardening-operations-docs.md#hoãn-sang-mvp-2) Hardening | Test hợp đồng Outline API, E2E SSO/move doc/sync, diễn tập nâng cấp Outline, rà bảo mật đầy đủ, backup ra ngoài máy, docs còn lại | 4 ngày |

## 5. Tiêu chí thành công

MVP 1:

- `system_admin` login Outline được khi ERP chưa có hoặc down; user stub login được ở dev.
- Share page cha → người nhận thấy toàn bộ page con, không thấy gì ngoài nhánh.
- Companion không bao giờ trả nội dung doc mà user không đọc được trong Outline.
- Tạo doc chuẩn từ template < 2 phút, style đồng nhất.
- Restore từ backup lên máy sạch thành công.

MVP 2:

- User ERP thật login Outline không cần account riêng.
- Quyền ERP đổi → Outline khớp sau tối đa 1 chu kỳ reconcile; user nghỉ việc bị suspend.

## 6. Giả định chưa kiểm chứng (không có spike)

| Giả định | Sai thì |
|---|---|
| OAuth app của Outline dùng được trên self-host | Fallback A (API key theo user, +2-4 ngày) hoặc B (login qua bridge + admin token + tự kiểm quyền, +4-6 ngày); dời endpoint bên thứ 3 sang MVP 2 |
| `oidc-provider` 9.x chạy như tài liệu (interaction tự viết, bỏ consent, adapter Postgres) | Tự hoàn tất consent trong interaction; thư viện không dùng được → dừng, plan lại phase 2 |
| Refresh token Outline dùng offline được | Endpoint bên thứ 3 chỉ trả `202 pendingUrl` |
| Placeholder `{{ten:kieu}}` đi qua markdown Outline nguyên vẹn | Parser bỏ escape; vẫn hỏng → tên biến camelCase hoặc đặt trong inline code |
| User đầu tiên login Outline mới cài thành admin | Promote bằng `users.update_role`, cuối cùng mới sửa role trong Postgres |
| Outline chấp nhận issuer/callback HTTP ở local | Thêm reverse proxy TLS tự ký vào compose |

Quá 2 ngày chưa login trọn luồng (phase 2) hoặc chưa lấy được token user (phase 4) → dừng, báo user.

## 7. Câu hỏi chưa giải quyết

1. Contract ERP: API login/verify JWT, API role (project → members/roles), webhook khi role đổi, cách chuyển session ERP sang bridge.
2. Chính sách + ngân sách gửi nội dung tài liệu ra Claude qua proxy (MVP 2).
3. Nơi deploy, domain, TLS (ai cấp cert, có reverse proxy sẵn chưa).
4. SMTP cho thông báo của Outline: có sẵn chưa, hay chạy không email.
5. Proxy có hỗ trợ streaming, prompt caching, `thinking` / `output_config`, beta header không (kiểm ở phase 5).
6. ERP định danh user bằng gì khi gọi endpoint bên thứ 3 (email có trùng email trong Outline không).
7. Trước phase 8 production chỉ `system_admin` login được → endpoint bên thứ 3 chưa dùng thật được ở MVP 1. Giữ hay dời sang MVP 2 để có ~6 ngày dự phòng.
