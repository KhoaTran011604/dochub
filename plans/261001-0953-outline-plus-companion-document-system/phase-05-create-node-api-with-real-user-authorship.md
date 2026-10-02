# Phase 05: API tạo node, tác giả là user thật

## Context Links

- [plan.md](./plan.md) · [phase 02](./phase-02-oidc-bridge-sso-token-handoff-and-local-system-admin.md) (`/sso`, `returnTo`) · [phase 03](./phase-03-outline-config-branding-and-api-client.md) (OAuth client) · [phase 04](./phase-04-permission-layer-api-users-projects-and-grants.md) (khung API, service key)
- [project-brief](./project-brief-tasks-spec-architecture-and-locked-stack.md) mục 3.4
- Source Outline `v1.10.1`: `server/routes/oauth/index.ts`, `app/scenes/Login/OAuthAuthorize.tsx`, `shared/helpers/AuthenticationHelper.ts`, `server/routes/api/documents/schema.ts`

## Overview

- Ngày: 2026-10-01
- Mô tả: `POST /api/v1/documents` cho ERP tạo node doc dưới tên user thật, trả link Outline. ERP bọc link bằng SSO → user 1 click vào sửa. Đây là luồng chính user quan tâm.
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 44h (5,5 ngày)

## Key Insights

Đã kiểm trên source Outline `v1.10.1`:

- Không có impersonation, không override tác giả ở `documents.create`, `apiKeys.create` không tạo key cho người khác → tác giả thật = phải có token của chính user.
- OAuth provider của Outline có trên self-host. `POST /oauth/authorize` chỉ nhận session ("Consent is given interactively") → mỗi user phải bấm **1 lần đồng ý** trong UI Outline.
- Refresh token luôn xoay (`alwaysIssueNewRefreshToken: true`) → refresh phải tuần tự hóa bằng khóa hàng, không thì mất grant.
- `/oauth/token` và `/oauth/authorize` giới hạn 100 request/giờ → phải cache access token tới khi hết hạn.
- Scope: `read | write | create`, dạng theo namespace `documents:create`. `documents.create` cần scope `create`; `auth.info` cần `read`.
- `documents.create` nhận `id` do client cấp → sinh `documentId` trước, lưu cùng idempotency key → gọi lại không tạo doc thứ 2.
- **Phát hiện mới:** `/oauth/authorize` khi CHƯA có phiên Outline render thẳng màn Login (không qua route cần đăng nhập) → không lưu `postLoginPath` → sau SSO user đứng ở trang chủ Outline, mất màn đồng ý. Có phiên rồi thì màn đồng ý hiện ngay. Xem mục "Cái giá của tác giả thật".

## Addendum 2026-10-02: hệ quả của login qua IdP thật (GH-1)

Không còn bước "ERP bọc link bằng SSO". Hợp đồng link đổi như sau:

| Mục | Trước | Giờ |
|---|---|---|
| Link ERP đưa cho user | `{bridge}/sso?token=<jwt>&returnTo=<url>` | **URL thuần** từ response API: `url` (`{outline}/doc/...`) hoặc `pendingUrl` (`{permissionApi}/pending/{id}`). ERP không ký gì |
| Đường đăng nhập khi chưa có phiên Outline | handoff từ JWT | Outline → bridge `/interaction` → nút SSO → IdP (user đã login ERP nên thường có phiên IdP) → về doc |
| `returnTo` allow-list `/pending/*` trong bridge | cần bật ở phase này | **Không cần nữa**. `PERMISSION_API_PUBLIC_URL` của bridge + nhánh `/pending/` trong `validate-return-to-url.ts` thành dead code; xóa cùng lúc xóa `/sso` (phase 6) |
| Login CSRF / Referer / `exp` ≤ 60s | ràng buộc hợp đồng JWT | Hết áp dụng với user thật; IdP lo |

Giả định mới, **thử ở ngày 1 cùng với OAuth Outline**: user đã có phiên IdP (login ERP trước) thì bước bridge → IdP **im lặng**, không hỏi mật khẩu lại. OpenIddict thường giữ cookie phiên; nếu IdP hỏi lại thì luồng vẫn chạy, chỉ thêm 1 màn login IdP, ghi vào tài liệu ERP.

Quyết định nút SSO (2026-10-02): trang `/interaction/:uid` hiện nút "Đăng nhập SSO" + form admin cùng trang theo yêu cầu user → luồng chính hiện là **2 click** (link ERP + nút). Mặc định giữ. Nếu khi nghiệm thu ngày 1 user muốn đúng "1 click": bridge tự 302 sang IdP khi có `UPSTREAM_OIDC_*`, form admin dời sang `/interaction/:uid/admin` (route riêng, phải thêm lại vì đã gộp về 1 trang; ~2h), và sửa tiêu chí thành công bên dưới. Vấn đề "chưa có phiên Outline → `/oauth/authorize` mất màn đồng ý" là của Outline, **không đổi** vì IdP.

## Cái giá của "tác giả thật" (để user cân nhắc lại)

Bước đồng ý + nhánh `202 pendingUrl` tồn tại CHỈ vì quyết định tác giả = user thật.

| Phương án | Trải nghiệm lần đầu của mỗi user | Effort phase 5 |
|---|---|---|
| **A. OAuth + đồng ý (đang chọn)** | Có phiên Outline: 1 click đồng ý → doc. Chưa có phiên: lần 1 chỉ đăng nhập (đứng ở trang chủ), mở lại link → đồng ý → doc. Các lần sau: `201` ngay | 44h |
| B. Tác giả = service account | Luôn `201`, không đồng ý. Doc ghi tác giả là account dịch vụ; user thật chỉ hiện ở lịch sử sửa. Bỏ: OAuth client, lưu grant, khóa refresh, nhánh pending, `/pending/*`, kiểm danh tính | ~14h (**tiết kiệm ~30h ≈ 3,75 ngày**) |
| C. BFF tự đi luồng OIDC thay user (headless) | Luôn `201`, tác giả thật, không đồng ý | ~31h |

Đánh giá C (chỉ giữ làm fallback): làm được vì ta sở hữu IdP, BFF tự ký handoff nội bộ rồi đi chuỗi redirect để lấy cookie `accessToken`. Không chọn vì: (1) token lấy được là phiên đầy đủ 3 tháng của user, không giới hạn scope, user không hề đồng ý; (2) dựa vào hành vi nội bộ không có hợp đồng (tên cookie, state) → dễ gãy khi nâng cấp Outline; (3) phải mở đường tin cậy BFF → bridge "đăng nhập thay bất kỳ ai", và Outline ghi nhận đăng nhập mà user không thực hiện (kể cả việc chấp nhận lời mời). Chỉ dùng nếu A không chạy trên self-host VÀ user không chịu B.

## Giả định + fallback (thử ngay ngày 1, bước 1)

| Giả định | Sai thì |
|---|---|
| OAuth của Outline chạy trên self-host: authorize → đồng ý → code → token; token gọi được `documents.create` + `auth.info` | B (service account) hoặc C; dừng, hỏi user |
| Refresh token dùng offline được, sống đủ lâu | Chỉ còn nhánh `202` mỗi khi access token hết hạn → gần như bắt buộc chuyển B/C |
| Scope `documents:create auth:read` đủ | Dùng `create read` |
| Chưa có phiên Outline → mất màn đồng ý (đọc source) | Nếu thực tế giữ được: bỏ ghi chú "mở lại link". Nếu đúng là mất: chấp nhận 2 lượt ở lần đầu; nâng cấp khi chung registrable domain: BFF đặt cookie `postLoginRedirectPath` (Domain cha, max-age 120s) trước khi chuyển sang Outline, xóa lại ở callback (+3h, dựa vào tên cookie nội bộ) |
| `documents.create` với `id` do client cấp chặn được tạo trùng | Trước khi tạo lại, tra `documents.info` theo id đã lưu |
| User chỉ có quyền mức node tạo được doc con dưới node đó | Yêu cầu role dự án `editor` trở lên; trả `403 ACTING_USER_FORBIDDEN` |

## Requirements

Chức năng:

```
POST /api/v1/documents
Authorization: Bearer <service key (scope documents:create)>     Idempotency-Key: <bắt buộc>
{ projectKey, actingErpUserId, title, text, parentDocumentId?, publish? = true }
→ 201 { documentId, url }
→ 202 { requestId, pendingUrl, expiresAt }
→ 400 | 401 | 403 | 404 | 409 | 429 | 502
```

- `text`: markdown. Không có template/form (đã bỏ).
- `url`: URL doc Outline thuần (`{OUTLINE_URL}/doc/...`). ERP đưa thẳng cho user, **không bọc** (đổi 2026-10-02, xem Addendum; trước là `{bridge}/sso?token&returnTo`). `pendingUrl` cũng đưa thẳng.
- Có grant còn hiệu lực của `actingErpUserId` → tạo bằng token user → `201`. Quyền do Outline ép; user không có quyền ghi → `403`.
- Chưa có grant / grant hỏng → lưu yêu cầu → `202`. Yêu cầu chờ hết hạn sau 7 ngày (env).
- Gửi lại cùng `Idempotency-Key` + cùng body → trạng thái hiện tại (`202` khi còn chờ, `201` khi đã tạo). Đây là cách ERP lấy `documentId` sau khi user hoàn tất. Cùng key khác body → `409`.
- `GET /pending/{requestId}` và `GET /oauth/outline/callback`: route trình duyệt, chỉ redirect, không render trang (lỗi → 1 dòng text + link ERP).

Phi chức năng:
- Token Outline của user không rời server, không log; lưu niêm phong (`iron-webcrypto`, không tự viết mã hóa).
- File < 200 dòng.

## Architecture

```
ERP ─ POST /api/v1/documents ─> permission API
       ├ idempotency (đã có kết quả → trả lại)
       ├ erp_users → outline_user_id; project_collection_map → collectionId
       ├ có grant → access token (refresh dưới SELECT … FOR UPDATE) → documents.create(id tự sinh) → 201
       └ không   → pending_document_requests → 202 { pendingUrl }

Trình duyệt: mở thẳng pendingUrl (chưa có phiên Outline → Outline → bridge → IdP → quay lại)
  → GET /pending/:id        (đã xong → 302 doc; chưa → state + PKCE, cookie ràng buộc) → 302 {outline}/oauth/authorize
  → user bấm Đồng ý (UI Outline)
  → GET /oauth/outline/callback?code&state
       đổi token → auth.info: user.id phải = outline_user_id của acting user (sai → thu hồi token, 403)
       lưu grant → documents.create → đánh dấu xong → 302 url doc
```

Bảng (migration 0004, schema `permission_api`):
- `user_outline_grants(erp_user_id PK, sealed_refresh_token, sealed_access_token, access_token_expires_at, scope, updated_at)`
- `pending_document_requests(id PK ngẫu nhiên 128 bit, service_client_id, idempotency_key, erp_user_id, payload, oauth_state, status, document_id, document_url, expires_at, completed_at)`
- `idempotency_keys(service_client_id, key, request_hash, document_id, response_status, response_body, created_at, PK(service_client_id, key))`

Refresh: 1 transaction: `SELECT … FOR UPDATE` dòng grant → còn hạn thì dùng → hết thì gọi `/oauth/token` → ghi token mới → commit. `invalid_grant` → xóa grant → rơi về nhánh `202`. Sập giữa lúc Outline đã xoay mà chưa commit → mất grant → tự lành bằng 1 lần đồng ý lại.

## Related Code Files

Tạo trong `apps/outline-permission-api/src/`:
- `documents/create-document-routes.ts`
- `documents/create-document-as-user-service.ts`
- `documents/idempotency-key-repository.ts`
- `outline-oauth/outline-oauth-authorization-flow.ts` (dựng URL authorize, state, PKCE, đổi code)
- `outline-oauth/user-outline-grant-repository.ts`
- `outline-oauth/get-outline-access-token-for-user.ts` (refresh có khóa)
- `outline-oauth/seal-and-unseal-token.ts`
- `pending/pending-document-request-repository.ts`
- `pending/pending-document-request-routes.ts` (`/pending/:id`, `/oauth/outline/callback`)

Tạo `packages/outline-api-client/src/`: `auth-api.ts`, `oauth-token-api.ts`; thêm `create` vào `documents-api.ts`.

Tạo: `packages/app-database/migrations/0004-create-user-grant-pending-request-and-idempotency-tables.sql`, `tests/e2e/create-node-pending-consent-flow.spec.ts`.

Sửa: `apps/outline-permission-api/src/users/set-erp-user-active-state-service.ts` (deactivate → xóa grant + gọi `/oauth/revoke`), `infra/.env.example` (`OUTLINE_OAUTH_CLIENT_ID/SECRET`, `TOKEN_SEAL_PASSWORD`, `PENDING_REQUEST_TTL_DAYS`).

## Implementation Steps

1. **Ngày 1:** bằng tay + script: authorize (đang có phiên) → đồng ý → đổi code → `documents.create` bằng token user → kiểm tác giả hiển thị đúng → refresh 2 lần liên tiếp. Thử thêm: mở URL authorize khi chưa có phiên, đi qua SSO, xem có quay lại màn đồng ý không. Ghi kết quả; sai giả định 1 hoặc 2 → dừng, hỏi user chọn B/C.
2. Client: `documents.create`, `auth.info`, đổi + refresh token.
3. Migration 0004.
4. Idempotency: băm body, sinh `documentId` trước, lưu, trả lại kết quả cũ.
5. Niêm phong token + grant repository + `get-outline-access-token-for-user` (khóa hàng). Unit test tranh chấp: 2 request cùng lúc → đúng 1 lần gọi refresh.
6. Service tạo doc (nhánh 201): tra user (active), tra collection theo `projectKey`, kiểm `parentDocumentId` thuộc đúng collection (`documents.info`), tạo, map lỗi Outline 403/404.
7. Nhánh 202: lưu yêu cầu; `GET /pending/:id`; callback (kiểm `state` ở DB + cookie, PKCE S256, kiểm danh tính bằng `auth.info`); hết hạn → 410.
8. Deactivate user → xóa grant + thu hồi token.
9. Test tích hợp với Outline thật: tác giả đúng user; user không có quyền ghi → 403; cùng key 2 lần → 1 doc; cùng key khác body → 409; người khác hoàn tất `pendingUrl` → 403, không lưu grant; yêu cầu hết hạn → 410; grant bị thu hồi phía Outline → `202` lại.
10. E2E (Playwright): `202` → mở `pendingUrl` bọc SSO khi đã có phiên → bấm Đồng ý → đứng ở doc mới; gửi lại cùng key → `201` cùng `documentId`.
11. Cập nhật nháp tài liệu API: hợp đồng bọc link, cách ERP xử lý `202`, ghi chú "lần đầu chưa có phiên: mở lại link".

## Todo List

- [ ] Ngày 1: thử OAuth Outline trọn vòng + refresh + hành vi khi chưa có phiên, ghi kết quả
- [ ] Client: `documents.create`, `auth.info`, token
- [ ] Migration 0004
- [ ] Idempotency + `documentId` sinh trước
- [ ] Niêm phong token, grant, refresh có khóa
- [ ] Nhánh 201
- [ ] Nhánh 202: lưu yêu cầu, `/pending/:id`, callback, kiểm danh tính, hết hạn
- [ ] Deactivate → thu hồi grant
- [ ] Integration test
- [ ] Playwright: chuỗi đồng ý
- [ ] Cập nhật nháp tài liệu API

## Success Criteria

- Luồng chính: ERP gọi API → nhận link → bọc SSO → user 1 click → đứng trong doc mới ở Outline, sửa được, tác giả là chính user.
- User đã đồng ý 1 lần: mọi lần sau `201` ngay, không thêm bước nào.
- Gửi lại cùng `Idempotency-Key` không bao giờ tạo doc thứ 2.
- Không ai hoàn tất được `pendingUrl` của người khác.
- Không có token Outline trong response, log, hay audit.

## Risk Assessment

- OAuth self-host không chạy như đọc source (rủi ro lớn nhất của phase) → bước 1 làm trước mọi thứ; fallback B/C ở trên.
- Lần đầu + chưa có phiên Outline = 2 lượt click. Ghi rõ trong tài liệu ERP; nâng cấp bằng cookie Domain cha nếu triển khai chung domain.
- Giới hạn 100 request/giờ của `/oauth/token` → cache access token; đợt đồng ý đầu của nhiều user cùng giờ có thể chạm trần → 429 + thử lại.
- Thời hạn refresh token chưa rõ → đo ở bước 1; ngắn thì user phải đồng ý lại định kỳ.
- Service key lộ = tạo doc dưới tên mọi user đã đồng ý trong phạm vi dự án của key → key chỉ có scope cần thiết, giới hạn `projectKey`, audit cả service client lẫn `actingErpUserId`.

## Security Considerations

- Service key không đọc được nội dung doc qua API này (chỉ tạo).
- Token niêm phong bằng `TOKEN_SEAL_PASSWORD` (≥ 32 ký tự, env); backup DB chứa token niêm phong → coi backup là dữ liệu nhạy cảm.
- OAuth: `state` 1 lần ràng buộc với trình duyệt bằng cookie `httpOnly`, PKCE S256, redirect URI khớp tuyệt đối, kiểm danh tính sau khi đổi token.
- `requestId` ngẫu nhiên 128 bit; `pendingUrl` không tự cấp quyền gì: vẫn cần phiên Outline của đúng user.
- Scope OAuth tối thiểu (`documents:create auth:read`).
- Validate `title`/`text` (độ dài tối đa), `parentDocumentId` phải thuộc collection của `projectKey`.

## Next Steps

- Phase 6: tài liệu tích hợp ERP bản chính, rà bảo mật, diễn tập restore.
- Nếu user đổi sang phương án B: xóa `outline-oauth/`, `pending/`, 2 bảng grant/pending, spec Playwright thứ 2.
