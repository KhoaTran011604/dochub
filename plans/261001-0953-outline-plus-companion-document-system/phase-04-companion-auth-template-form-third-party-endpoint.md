# Phase 04: Companion: auth, template → form → doc, endpoint bên thứ 3

## Context Links

- [plan.md](./plan.md) · [phase 03](./phase-03-project-conventions-and-permission-sync-job.md)
- [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) mục 4.2, 5
- Quy tắc frontend: `.claude/rules/development-rules.md` (giữ tinh thần; các file `apps/web/...`, GenericForm, GenericTable nêu trong đó KHÔNG tồn tại ở repo này)

## Overview

- Ngày: 2026-10-01
- Mô tả: app Next.js. User đăng nhập bằng OAuth của Outline, chọn template, điền form sinh tự động từ placeholder, tạo doc vào đúng collection/parent, nhận link Outline. Thêm endpoint service-to-service cho ERP tạo node doc.
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 104h (13 ngày; +2-6 ngày nếu OAuth app Outline phải fallback → khi đó dời endpoint bên thứ 3 sang MVP 2 để giữ lịch)
- <!-- Updated: Validation Session 1 - endpoint bên thứ 3 tạo doc dưới tên user ERP thật (+3 ngày) -->

### Thay đổi sau validation: tác giả doc từ endpoint bên thứ 3 = user ERP thật

Endpoint bên thứ 3 KHÔNG tạo doc bằng admin token nữa. ERP truyền `actingUserEmail`; companion tạo doc bằng token Outline của chính user đó:

- **Có grant** (user đã từng login companion, refresh token còn hạn): tạo ngay bằng token user → `201 { documentId, url }`. Quyền do Outline ép: user không có quyền ghi → `403`.
- **Chưa có grant / grant hết hạn**: lưu yêu cầu vào `companion.pending_document_requests` → `202 { pendingUrl }`. User mở `pendingUrl` → login companion → companion tạo doc bằng token user → redirect sang Outline. Yêu cầu chờ hết hạn sau 7 ngày (cấu hình được), chỉ đúng user được chỉ định mới hoàn tất được.
- Grant lưu riêng khỏi session: bảng `companion.user_outline_grants` (refresh token niêm phong, theo user), không bị xóa khi logout session trình duyệt; bị xóa khi user thu hồi hoặc bị suspend.
- Nếu refresh token của Outline không dùng offline được (user không online) → chỉ còn nhánh `202 pendingUrl`.

Phần này thay thế mọi chỗ bên dưới nói endpoint ngoài dùng admin token. Admin token chỉ còn dùng ở CLI đăng ký dự án (phase 3) và job sync (phase 9, MVP 2).

Việc thêm: migration 0004 thêm 2 bảng trên; `lib/external/user-outline-grant-repository.ts`; `lib/external/pending-document-request-repository.ts`; `app/(app)/pending/[id]/page.tsx`; hợp đồng thêm `actingUserEmail` (bắt buộc) và response `202`; test: tác giả hiển thị đúng user, user khác mở `pendingUrl` → 403, yêu cầu hết hạn → 410.

Rủi ro/bảo mật thêm: service key của ERP giờ có thể tạo doc dưới tên bất kỳ user nào đã có grant → key chỉ được phép tạo doc (không đọc), giới hạn theo `projectKey`, audit ghi cả service client lẫn `actingUserEmail`; refresh token niêm phong, không log.

## Key Insights

- "Đăng nhập bằng Outline" cho cả định danh lẫn token thay mặt user trong 1 luồng → companion không cần là OIDC client của bridge. Admin companion = role admin trong Outline (`auth.info`).
- Mọi thao tác của user dùng token của user → Outline tự ép quyền. Endpoint bên thứ 3 cũng dùng token của user được chỉ định (`actingUserEmail`, qua grant). Admin token không dùng ở phase này.
- Không có editor trong companion. Template soạn trong Outline, sửa doc sau khi tạo cũng trong Outline.
- Token Outline không bao giờ xuống trình duyệt (BFF: route handler gọi Outline).
- Cú pháp placeholder `{{ten:kieu}}` là giả định: chưa kiểm Outline có escape `_ { } | ( )` khi lưu markdown không → kiểm bằng 1 template thật ngay khi viết parser (bước 6).

## Giả định (chưa kiểm chứng, không có phase spike)

- Outline self-host có OAuth app: authorization code, token user gọi được `auth.info` + `documents.*`, quyền do Outline ép. Sai → fallback A hoặc B (mục Risk).
- Có refresh token dùng offline được. Sai → endpoint bên thứ 3 chỉ trả `202 pendingUrl`.
- `documents.create` trả `url` mở được trong trình duyệt. Không có → ghép từ `urlId` hoặc gọi thêm `documents.info`.
- Placeholder đi qua markdown của Outline nguyên vẹn. Sai → parser bỏ escape `\` trước khi dò; vẫn hỏng → tên biến camelCase hoặc đặt placeholder trong inline code.

## Requirements

Chức năng:
- Login/logout qua OAuth app Outline (authorization code + PKCE nếu có, refresh nếu có).
- Liệt kê template: doc con của `Mẫu tài liệu` mà user đọc được.
- Dò placeholder `{{ten:kieu}}`. Kiểu MVP: `text` (mặc định), `longtext`, `number`, `date`, `select(a|b|c)`. Trùng tên = 1 field.
- Form động + validate → merge → `documents.create` (collectionId, parentDocumentId tùy chọn, title, text, publish) → trả link Outline.
- Chọn đích: collection user có quyền ghi + cây doc để chọn parent. Deep link `?collectionId=&parentDocumentId=` để ghim link từ Outline.
- Endpoint `POST /api/v1/external/documents`: auth bằng service key, tạo doc (từ template + values, hoặc text thô), trả `{ documentId, url }`.

Phi chức năng:
- Query key tập trung 1 file; mỗi domain 1 thư mục `queries.ts` + `mutations.ts`; hook dùng generic.
- Hook mutation chỉ invalidate cache; toast/redirect truyền qua callback từ component gọi.
- 1 component form động dùng chung (phase 5 dùng lại), không dựng form riêng lẻ.
- try/catch ở mọi route handler; lỗi trả về không lộ chi tiết nội bộ.
- File < 200 dòng.

## Architecture

```
Browser ─cookie session─> Next.js route handlers
   route handler ─token user (giải mã từ DB)─> outline-api-client ─> Outline
   /api/v1/external/* ─service key + actingUserEmail─> outline-api-client (token của user đó, từ grant) ─> Outline
```

- Session: cookie niêm phong (`iron-session`) chỉ chứa session id + thông tin hiển thị. Token Outline lưu bảng `companion.user_sessions`, niêm phong bằng `sealData` của cùng thư viện (không tự viết mã hóa). Refresh token dưới khóa hàng (`SELECT ... FOR UPDATE`) tránh 2 request cùng refresh.
- UI: shadcn/ui + react-hook-form + zod + TanStack Query.
- Merge: thay thế chuỗi thuần, giá trị thiếu → lỗi validate (không để sót `{{...}}` trong doc).
- Endpoint ngoài: header `Authorization: Bearer <service key>`, `Idempotency-Key` bắt buộc; key lưu dạng băm trong env/DB kèm danh sách `projectKey` được phép; ghi audit.

Hợp đồng endpoint ngoài:

```
POST /api/v1/external/documents
{ projectKey, actingUserEmail, parentDocumentId?, title, templateId?, values?, text?, publish? }
→ 201 { documentId, url }   | 202 { pendingUrl }   | 400 | 401 | 403 | 409 (idempotency trùng khác body) | 429
```

## Related Code Files

Tạo `packages/outline-api-client/src/`: `documents-api.ts`, `auth-api.ts`, `oauth-token-api.ts`.

Tạo `apps/companion/`:
- `app/login/page.tsx`
- `app/api/auth/outline/login/route.ts`, `.../callback/route.ts`, `.../logout/route.ts`
- `lib/auth/outline-oauth-flow.ts`
- `lib/auth/user-session-repository.ts`
- `lib/auth/require-user-session.ts`
- `lib/auth/get-outline-client-for-user.ts`
- `lib/templates/placeholder-parser.ts`
- `lib/templates/placeholder-field-types.ts`
- `lib/templates/build-form-schema-from-placeholders.ts`
- `lib/templates/merge-template-with-values.ts`
- `lib/documents/create-document-from-template-service.ts` (dùng chung cho UI, endpoint ngoài, phase 5)
- `app/api/templates/route.ts`, `app/api/templates/[id]/route.ts`
- `app/api/collections/route.ts`, `app/api/collections/[id]/document-tree/route.ts`
- `app/api/documents/route.ts`
- `app/(app)/templates/page.tsx`, `app/(app)/templates/[id]/new/page.tsx`
- `components/dynamic-placeholder-form.tsx`
- `components/document-destination-picker.tsx`
- `components/ui/*` (shadcn)
- `queries/query-keys.ts`
- `queries/templates/queries.ts`, `queries/collections/queries.ts`, `queries/documents/mutations.ts`
- `app/api/v1/external/documents/route.ts`
- `lib/external/service-client-authenticator.ts`
- `lib/external/idempotency-key-repository.ts`
- `lib/audit/companion-audit-logger.ts`
- `lib/config/environment-config.ts`
- `Dockerfile`

Tạo: `packages/app-database/migrations/0004-create-companion-session-and-external-request-tables.sql`.

Sửa: `infra/docker-compose.yml`, `infra/.env.example`.

## Implementation Steps

1. Đăng ký OAuth app trong Outline, ghi bước vào `infra/README.md`. Làm bước 2 + 4 ngay sau đó để biết sớm OAuth có chạy trên self-host không; quá 2 ngày chưa lấy được token user → báo user, chọn fallback.
2. Bổ sung `outline-api-client`: documents (info, list, create), `auth.info`, đổi/refresh token.
3. Migration 0004: `user_sessions`, `user_outline_grants`, `pending_document_requests`, `external_idempotency_keys`, `companion_audit_log`.
4. Luồng OAuth: state + PKCE, callback đổi code, gọi `auth.info`, tạo session. Logout xóa session.
5. `require-user-session` + `get-outline-client-for-user` (refresh có khóa).
6. Parser placeholder (lấy markdown của 1 template thật qua `documents.info` làm mẫu test, xử lý escape nếu có) + unit test dày: lồng nhau, trùng tên, kiểu lạ, option select có khoảng trắng, tiếng Việt có dấu.
7. Sinh zod schema + merge; test.
8. Route handlers template/collection/document, tất cả dùng token user.
9. UI: danh sách template → trang tạo (form động + chọn đích) → thành công hiện link "Mở trong Outline".
10. Query keys tập trung + hook theo domain; callback UI truyền từ page.
11. Endpoint ngoài: xác thực service key (so sánh hằng thời gian), kiểm `projectKey` được phép, tra mapping → collectionId, idempotency, rate limit, audit.
12. Test: unit; tích hợp với Outline thật: user A không có quyền collection X → không thấy template/collection/doc của X qua bất kỳ route nào; tạo doc vào X bị từ chối.

## Todo List

- [ ] Đăng ký OAuth app Outline
- [ ] Mở rộng `outline-api-client`
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

## Success Criteria

- User ERP (stub) đã login Outline → vào companion không phải nhập lại mật khẩu.
- Chọn template → điền → doc xuất hiện đúng vị trí trong Outline, không còn `{{...}}`, < 2 phút.
- User không có quyền đọc doc/collection: mọi route companion trả 403/404, không lộ tiêu đề hay nội dung.
- Endpoint ngoài: key sai → 401; `projectKey` ngoài phạm vi → 403; gửi lại cùng `Idempotency-Key` → cùng kết quả, không tạo doc thứ 2.
- Không có token Outline trong response hay log.

## Risk Assessment

- OAuth app Outline không dùng được trên self-host (rủi ro lớn nhất của MVP 1, chưa kiểm chứng):
  - Fallback A (API key theo user: user tự tạo trong Outline, dán vào companion, lưu niêm phong): UX kém nhưng quyền vẫn do Outline ép; +2-4 ngày.
  - Fallback B (companion login qua bridge + admin token + tự kiểm quyền): dễ sai nhất, phải có test phân quyền cho từng route; +4-6 ngày; cần thêm client `companion` ở bridge. Chỉ dùng khi A không được.
  - Cả 2 đều vượt ngân sách 30 ngày → dời endpoint bên thứ 3 sang MVP 2.
- Outline đổi markdown khi lưu → doc tạo ra lệch format: kiểm bằng template thật ở bước 6.
- Template có placeholder sai cú pháp → hiện cảnh báo cho người soạn, không đoán.

## Security Considerations

- Cookie session `httpOnly/secure/sameSite=lax`; kiểm `state`; PKCE nếu Outline hỗ trợ.
- CSRF: route ghi chỉ nhận JSON + kiểm Origin.
- Service key entropy cao, lưu dạng băm, xoay vòng được; giới hạn theo `projectKey`.
- Validate mọi input bằng zod; giới hạn kích thước body.
- Admin token không được import ở bất kỳ route nào của companion (chỉ CLI phase 3 dùng); thêm lint rule/kiểm review.
- Audit: ai tạo doc gì, ở đâu, qua kênh nào.

## Next Steps

- Phase 7: E2E không lộ doc ngoài quyền + template → doc.
- Phase 5 (MVP 2) dùng lại form động + `create-document-from-template-service`.
- Ghim link companion trong Outline (doc hướng dẫn trong collection `Templates`).
