# Hướng dẫn tích hợp ERP ↔ Permission API (HD Document)

> Tài liệu sống. Cập nhật lần cuối: 2026-10-05, sau phase 5. **Phải cập nhật lại sau phase 7** (xem mục 9).
> Nguồn sự thật là code trong `apps/outline-permission-api/src`; tài liệu này mô tả hành vi thực tế đã dựng.

## 1. Bức tranh chung

ERP gọi **permission API** (Koa, port nội bộ 4100) bằng **service key** để:
1. Đẩy user ERP sang Outline (`/users/...`).
2. Tạo dự án (= 1 collection Outline) và gán role cho user (`/projects/...`).
3. Gán quyền mức node/doc (`/documents/{id}/members/...`).
4. **Tạo node doc dưới tên user thật** (`POST /documents`, phase 5) → ERP nhận link Outline đưa cho user.

User đăng nhập Outline qua SSO (bridge → IdP `idp.hdwebsoft.co`). ERP **không ký token/SSO gì** — chỉ đưa URL thuần từ response.

```
ERP ──service key──> permission API ──admin token──> Outline (user/group/collection)
                          │
                          └─ token OAuth của chính user ──> Outline documents.create  (tác giả = user thật)
```

Base URL dev (host): `http://localhost:4100`. Trong mạng compose: `http://outline-permission-api:4100`. **Không có prefix `/api/v1`** — route nằm ở gốc (plan ghi `/api/v1/...` nhưng code chưa dùng prefix; nếu thêm prefix sau này sẽ ghi ở mục 9).

## 2. Xác thực (service key)

- Header: `Authorization: Bearer <service key>`. Lỗi: `401` (thiếu/sai key).
- Mỗi key có **scope** + **project-keys** cho phép. Thiếu scope → `403 SCOPE_FORBIDDEN`; sai project → `403 PROJECT_KEY_FORBIDDEN`.

| Scope | Cho phép |
|---|---|
| `users:write` | `/users/*` |
| `permissions:write` | `/projects/*`, `/documents/:id/members/*` |
| `documents:create` | `POST /documents` (phase 5) |
| `tree:read` | `GET /projects/{projectKey}/document-tree` (phase 7) |

Quản lý key (key chỉ in ra **1 lần**):
```sh
pnpm --filter @hd-document/outline-permission-api manage-service-client create erp-main \
  --scopes users:write,permissions:write,documents:create --project-keys "*"
# rotate | revoke tương tự: manage-service-client rotate erp-main
```
Script này kết nối DB từ host: cần `PERMISSION_API_DATABASE_URL` (xem `infra/README.md`), ví dụ
`postgres://permission_api_app:<PERMISSION_API_DB_PASSWORD>@localhost:55432/hd_document_apps`.

Chung cho mọi route: lỗi trả dạng `{ "error": { "code", "message" }, "requestId" }`; có rate limit (429 + `Retry-After`) và audit theo service client.

## 3. Danh sách endpoint

ID ERP user (`erpUserId`/`actingErpUserId`) **phải là UUID** = `sub` của IdP.

### 3.1 Users — scope `users:write`
| Method | Path | Body | Kết quả |
|---|---|---|---|
| PUT | `/users/:erpUserId` | `{ email, name }` | upsert user + mời vào Outline |
| POST | `/users/batch-upsert` | `{ users: [{erpUserId,email,name}] }` (1–20) | `{ results }` |
| POST | `/users/:erpUserId/deactivate` | – | `{erpUserId,status:"deactivated"}`; **mới (phase 5):** xóa grant OAuth + thu hồi token user |
| POST | `/users/:erpUserId/activate` | – | `{erpUserId,status:"active"}` |

Lỗi: `409 EMAIL_ALREADY_IN_USE`, `403 SYSTEM_ADMIN_EMAIL_RESERVED` (email `SYSTEM_ADMIN_EMAIL` bị cấm đụng).

### 3.2 Projects — scope `permissions:write`
| Method | Path | Body | Kết quả |
|---|---|---|---|
| PUT | `/projects/:projectKey` | `{ name }` | `{ projectKey, collectionId, url }` (idempotent) |
| PUT | `/projects/:projectKey/members/:erpUserId` | `{ role: viewer\|editor\|manager }` | `{projectKey,erpUserId,role}` |
| DELETE | `/projects/:projectKey/members/:erpUserId` | – | `204` |

`projectKey` theo regex trong `projects-routes.ts` (`INVALID_PROJECT_KEY` nếu sai).

### 3.3 Quyền mức node — scope `permissions:write`
| Method | Path | Body | Kết quả |
|---|---|---|---|
| PUT | `/documents/:documentId/members/:erpUserId` | `{ permission: read\|read_write }` | `{documentId,erpUserId,permission}` |
| DELETE | `/documents/:documentId/members/:erpUserId` | – | `204` |

### 3.4 Tạo node — scope `documents:create` (MỚI, phase 5)

```
POST /documents
Authorization: Bearer <key>
Idempotency-Key: <1–200 ký tự ASCII in được>     ← bắt buộc
Content-Type: application/json

{
  "projectKey": "PRJ-001",
  "actingErpUserId": "<uuid user sẽ là tác giả>",
  "title": "Biên bản họp",            // 1–255
  "text": "# Markdown ...",            // ≤ 200.000 ký tự
  "parentDocumentId": "<uuid>",        // tùy chọn, phải thuộc collection của projectKey
  "publish": true                      // mặc định true
}
```

| Status | Ý nghĩa | Body |
|---|---|---|
| `201` | Đã tạo, tác giả = user thật | `{ documentId, url }` |
| `202` | User chưa đồng ý OAuth (hoặc grant hỏng/thu hồi) | `{ requestId, pendingUrl, expiresAt }` |
| `400` | Sai body/header; `PARENT_DOCUMENT_WRONG_PROJECT`; `IDEMPOTENCY_KEY_REQUIRED` | |
| `403` | `USER_DEACTIVATED`, `ACTING_USER_FORBIDDEN` (user không có quyền ghi), `PROJECT_KEY_FORBIDDEN` | |
| `404` | `USER_NOT_FOUND`, `PROJECT_NOT_FOUND`, `PARENT_DOCUMENT_NOT_FOUND` | |
| `409` | `IDEMPOTENCY_KEY_REUSED` (cùng key, khác body) | |
| `410` | `PENDING_REQUEST_EXPIRED` (yêu cầu chờ quá hạn; dùng key mới) | |
| `429` / `502` | Outline/OAuth giới hạn tốc độ / lỗi upstream → thử lại | |

**Cách ERP xử lý:**
1. Sinh `Idempotency-Key` (vd UUID gắn với bản ghi nghiệp vụ), gọi `POST /documents`.
2. `201` → lưu `documentId`+`url`; đưa `url` cho user (link thuần, không bọc).
3. `202` → lưu `requestId`; đưa **`pendingUrl`** cho user mở. User bấm "Đồng ý" 1 lần trong Outline → tự động tạo doc → trình duyệt chuyển vào doc.
4. Để biết kết quả sau 202: **gọi lại đúng cùng `Idempotency-Key` + cùng body** → `202` (còn chờ) hoặc `201 {documentId,url}` (đã xong). Không webhook.
5. Retry khi timeout/5xx: dùng lại **cùng key** — không bao giờ tạo doc thứ 2.
6. Lần sau, user đã đồng ý → luôn `201` ngay.
7. Lần đầu mà user **chưa có phiên Outline**: đã kiểm thật (2026-10-05) — sau bước đăng nhập SSO Outline quay lại **màn đồng ý**, không cần mở lại link. Chưa thử với IdP thật khi user chưa có phiên IdP (dự kiến chỉ thêm 1 màn login IdP).

### 3.5 Cây tài liệu — scope `tree:read` (MỚI, phase 7)

```
GET /projects/{projectKey}/document-tree?actingErpUserId=<uuid>&parentDocumentId=<uuid>?&depth=<1-5>
Authorization: Bearer <key>
```

| Query | Kiểu | Mô tả |
|-------|------|-------|
| `actingErpUserId` | UUID | Bắt buộc; user ERP sẽ đọc quyền của họ |
| `parentDocumentId` | UUID | Tùy chọn; tài liệu cha. Nếu bỏ → gốc collection |
| `depth` | số 1–5 | Tùy chọn, mặc định 2; số cấp trả về dưới điểm bắt đầu |

| Status | Ý nghĩa | Body |
|---|---|---|
| `200` | Thành công | `{ projectKey, parentDocumentId, truncated, nodes:[{id,title,url,parentDocumentId,hasMoreChildren,children[]}] }` |
| `400` | Sai query; `INVALID_PROJECT_KEY` | |
| `403` | `ACTING_USER_FORBIDDEN` (user không có quyền đọc collection) | |
| `404` | `USER_NOT_FOUND`, `PROJECT_NOT_FOUND`, `PARENT_DOCUMENT_NOT_FOUND` | |
| `409` | `OUTLINE_GRANT_REQUIRED` (user chưa cấp scope `read` trong OAuth) | `{ error: {...}, grantUrl: "<pending-url>" }` |

**Ghi chú:**
- Max 1000 nodes trên 1 response; nếu vượt → `truncated: true`, gọi lại với `parentDocumentId` = một node con để tiếp.
- Node không có nội dung; chỉ `id`, `title`, `url`, `parentDocumentId`, `hasMoreChildren`, `children[]` (những node con nếu `depth > 1`).
- Quyền kiểm ở phía Outline: nếu user không thấy tài liệu hoặc không có quyền collection → `403 ACTING_USER_FORBIDDEN`.
- 409 Grant: ERP đưa user mở `grantUrl`, user bấm Đồng ý → cấp scope `read` → retry API.

**Cách ERP xử lý:**
1. Gọi `GET /projects/PRJ-001/document-tree?actingErpUserId=<uuid>&depth=2`.
2. `200` → xử lý `nodes`, nếu `truncated=true` → gọi lại với `parentDocumentId` = từng node con để lấy chi tiết.
3. `409` → lưu `grantUrl`, đưa user mở nó (tái sử dụng flow `/pending/:id`), rồi retry API.

### 3.6 Route trình duyệt (không phải cho ERP gọi)
- `GET /pending/:id` → redirect sang `{OUTLINE_URL}/oauth/authorize` (state + PKCE S256, cookie httpOnly) hoặc thẳng tới doc nếu đã xong. Hỗ trợ cả luồng tạo doc (phase 5) và cấp quyền đọc (phase 7).
- `GET /oauth/outline/callback?code&state` → đổi token, kiểm danh tính (`auth.info` phải đúng user), lưu grant, tạo doc (nếu pending request), redirect tới doc hoặc trang xác nhận. Lỗi hiển thị 1 dòng text + link `ERP_PORTAL_URL`.
- `GET /healthz` — không cần key.

## 4. Cấu hình (infra/.env)

| Biến | Ý nghĩa |
|---|---|
| `OUTLINE_OAUTH_CLIENT_ID/SECRET` | Tạo bằng `pnpm --filter @hd-document/outline-workspace-setup register-oauth-client` |
| `PERMISSION_API_PUBLIC_URL` | URL **trình duyệt user** mở được tới service; redirect URI = `<URL>/oauth/outline/callback` phải khớp OAuth client |
| `TOKEN_SEAL_PASSWORD` | ≥ 32 ký tự; niêm phong token. Đổi = user đồng ý lại |
| `OUTLINE_OAUTH_SCOPE` | mặc định `documents:create auth:read read` (scope `read` tự thêm nếu thiếu cho API cây tài liệu phase 7) |
| `PENDING_REQUEST_TTL_DAYS` | mặc định 7 |
| `ERP_PORTAL_URL` | link "quay lại ERP" trên trang lỗi |

Thiếu 1 trong `PERMISSION_API_PUBLIC_URL`, `OUTLINE_OAUTH_CLIENT_ID/SECRET`, `TOKEN_SEAL_PASSWORD` → nhóm route phase 5 **tắt** (`POST /documents` 404).

> Lưu ý hiện trạng `.env` của bạn: `PERMISSION_API_PUBLIC_URL=http://localhost:4002` nhưng service publish ở host port `PERMISSION_API_HOST_PORT=4100`. Nếu không có proxy/tunnel 4002→4100, `pendingUrl` sẽ không mở được và redirect URI OAuth sai. Sửa cho khớp (và cập nhật redirect URI của OAuth client) trước khi test luồng 202.

## 5. Dựng & migrate (dev)

```powershell
# migration 0004 (bảng grant/pending/idempotency) — role owner
$env:APP_DATABASE_URL = "postgres://hd_document_apps:<APP_DB_PASSWORD>@localhost:55432/hd_document_apps"
pnpm --filter @hd-document/app-database migrate
# build lại
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build outline-permission-api oidc-bridge
curl.exe http://localhost:4100/healthz
```
Đã chạy ngày 2026-10-05: migration 0004 áp thành công, 5 container healthy, `/pending/<id lạ>` → 404 (route phase 5 đã bật).

## 6. Cách test các API

Chuẩn bị 1 lần (PowerShell; key lấy từ lệnh `manage-service-client create`):
```powershell
$B = "http://localhost:4100"; $H = @{ Authorization = "Bearer $KEY" }
$U = "<uuid = sub của 1 user IdP thật>"
```

1. **User:** `curl.exe -X PUT $B/users/$U -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{\"email\":\"a@x.com\",\"name\":\"A\"}'`
2. **Project:** `PUT /projects/PRJ-001` body `{"name":"Dự án 1"}` → ghi `collectionId`.
3. **Role:** `PUT /projects/PRJ-001/members/$U` body `{"role":"editor"}` (cần `editor` trở lên để tạo doc).
4. **Tạo node lần đầu (kỳ vọng 202):**
   `POST /documents` + `Idempotency-Key: t1` + body mục 3.4 → `202 {pendingUrl}`.
5. Mở `pendingUrl` bằng trình duyệt, đăng nhập đúng user → bấm **Đồng ý** → vào doc mới. Kiểm tác giả trong Outline = user đó.
6. **Hỏi lại trạng thái:** POST lại y hệt (`Idempotency-Key: t1`) → `201` cùng `documentId`.
7. **Tạo lần 2 key mới (`t2`):** → `201` ngay (đã có grant).
8. **Idempotency:** cùng `t1` khác `title` → `409 IDEMPOTENCY_KEY_REUSED`.
9. **Quyền:** hạ user xuống `viewer` → `403 ACTING_USER_FORBIDDEN`.
10. **Deactivate:** `POST /users/$U/deactivate` rồi tạo node → `403 USER_DEACTIVATED`; `activate` rồi tạo node → `202` (grant đã bị xóa, đồng ý lại).
11. **Cây tài liệu (phase 7):**
    - Tạo key mới với scope `tree:read`: `pnpm --filter @hd-document/outline-permission-api manage-service-client create erp-tree --scopes tree:read --project-keys "*"`.
    - `GET /projects/PRJ-001/document-tree?actingErpUserId=$U&depth=2` (scope `tree:read` bắt buộc) → `200 {projectKey,truncated,nodes}` nếu user đã cấp scope `read` trong OAuth.
    - User lần đầu (chưa cấp scope `read`) → `409 {grantUrl}` → mở grantUrl → "Đồng ý" → retry → `200`.
    - Hạ user xuống `viewer` → `403 ACTING_USER_FORBIDDEN`.
    - Query invalid (sai UUID, depth > 5) → `400`.

Test tự động: `pnpm -r typecheck`, `pnpm -r test` (permission API có test cho tree endpoint). **Chưa có** integration test với Outline thật cho luồng grant 409 (xem mục 8).

## 7. Mô hình dữ liệu (schema `permission_api`)
`erp_users`, `project_collection_map`, `service_clients`, audit; phase 5 thêm: `user_outline_grants` (token niêm phong), `pending_document_requests`, `idempotency_keys`. Backup DB chứa token niêm phong → coi là dữ liệu nhạy cảm.

## 8. Trạng thái & giới hạn đã biết (cập nhật 2026-10-05, sau phase 7)

**Đã kiểm trên Outline 1.10.1 thật** (báo cáo: `plans/reports/fullstack-developer-261005-GH-5-phase-05-real-outline-verification.md`):
- authorize → đồng ý → token → `documents.create` bằng token user → tác giả đúng user. Phương án B/C của plan **không cần**.
- Scope `documents:create auth:read` chạy được (`create read` cũng được). `auth:read_write` **không hợp lệ** (nút Authorize treo).
- Access token sống 3600s; refresh token sống 30 ngày, **trượt** theo mỗi lần refresh (user chỉ đồng ý lại sau 30 ngày không dùng); refresh xoay token mỗi lần, dùng lại token cũ → 400.
- `OUTLINE_OAUTH_CLIENT_ID` phải là **`clientId` công khai** (không phải UUID `id`); CLI `register-oauth-client` đã sửa để in đúng.
- Test: Playwright `tests/e2e/create-node-pending-consent-flow.spec.ts` + `create-node-real-outline-integration.spec.ts` (8 test pass). Chạy: `cd tests/e2e; npx playwright test create-node` (cần `E2E_PERMISSION_API_SERVICE_KEY` trong `tests/e2e/.env`).

**Đã làm ở phase 5:** audit `POST /documents` ghi `actingErpUserId`/`projectKey`/`documentId`/`resultStatus`; 2 route trình duyệt có rate limit 30 req/phút/IP (cần `PERMISSION_API_TRUST_PROXY=true` sau reverse proxy) + log; job dọn dòng pending/idempotency hết hạn (mỗi giờ, migration 0005); `parentDocumentId` được kiểm trước khi trả 202; lỗi validate 4xx xóa idempotency row nên retry cùng key sau khi sửa body không bị 409; `auth.info` lỗi mạng → `503 OUTLINE_UNAVAILABLE` (không thu hồi token, user mở lại pendingUrl).

**Đã làm ở phase 7:** API cây tài liệu `GET /projects/{projectKey}/document-tree` + scope `tree:read` (service key); dùng OAuth token của user nên Outline tự enforce quyền; user chưa cấp scope `read` → `409 OUTLINE_GRANT_REQUIRED` + grantUrl (reuse `/pending/:id` consent flow, migration 0006); max 1000 nodes/response, `truncated` flag nếu vượt; mỗi node chỉ ghi `id`/`title`/`url`/`parentDocumentId`/`hasMoreChildren`/`children` (không nội dung); depth 1–5 mặc định 2; audit ghi `actingErpUserId`/`projectKey`/`resultStatus`.

**Còn lại / lưu ý:**
- Request song song cùng `Idempotency-Key`: đã sửa, cả hai đều `201` cùng 1 doc (test e2e khẳng định). ERP vẫn nên retry khi nhận `5xx`.
- Replay `202` vẫn là `202` nếu user đã có grant nhưng lần tạo trước thất bại → dùng key mới.
- `/oauth/token` giới hạn 100 req/giờ → có thể `429`.
- Chưa test IdP thật khi user chưa có phiên IdP.
- Spec `sso-handoff-link-opens-document-as-erp-user` cũ đang fail ở `beforeAll` (màn login Outline giờ có 2 nút) — cần cập nhật fixture, thuộc phase 6.

## 9. Việc cập nhật sau phase 7+

- Phase 6: tài liệu tích hợp bản chính, rà bảo mật; xóa `/sso` + dead code `/pending` allow-list ở bridge; có thể thêm prefix `/api/v1` — cập nhật Base URL mục 1.
- Mỗi lần đổi hợp đồng API: sửa file này cùng PR và ghi `docs/project-changelog.md`.
