# Phase 10 (MVP 2): API cây tài liệu cho bên thứ 3

## Context Links

- [plan.md](./plan.md) · [phase 04](./phase-04-companion-auth-template-form-third-party-endpoint.md) (service key, grant theo user) · [phase 09](./phase-09-permission-sync-worker.md) · [phase 08](./phase-08-deferred-real-erp-auth-and-role-adapters.md)

## Overview

- Ngày: 2026-10-01
- Mô tả: endpoint đọc cho ERP lấy cây tài liệu của 1 dự án theo đúng quyền của 1 user, để ERP hiển thị cây + link mở Outline và chọn `parentDocumentId` khi tạo node.
- Priority: P2
- Implementation status: Deferred (MVP 2, sau phase 9 + 8)
- Review status: Chưa review
- Effort: 16h (2 ngày)

## Key Insights

- Quyền ERP → Outline đã do sync (phase 9 + 8) đẩy vào group. Đọc cây bằng token của chính user (`actingUserEmail`, grant phase 4) → Outline tự ép quyền, kể cả doc được share riêng. Companion không tự kiểm quyền, không dùng admin token.
- Hệ quả: user chưa từng login companion (chưa có grant) thì chưa đọc được cây → trả link cấp quyền, giống nhánh `pendingUrl` của endpoint tạo node.
- Service key của ERP ở phase 4 chỉ có quyền tạo. Phase này thêm scope đọc cây (chỉ tiêu đề + link, không trả nội dung doc).

## Requirements

Chức năng:
- `GET /api/v1/external/projects/{projectKey}/document-tree?actingUserEmail=&parentDocumentId?=`
- Trả cây node user đọc được: `{ id, title, url, parentDocumentId, children[] }`.
- Chưa có grant / grant hết hạn → `409 { grantUrl }`.
- `projectKey` ngoài phạm vi service key → `403`; user không có quyền collection → `403`.

Phi chức năng:
- Không trả nội dung doc. Giới hạn độ sâu/số node, có phân trang theo nhánh (`parentDocumentId`) cho cây lớn.
- Rate limit + audit (service client, `actingUserEmail`, `projectKey`).
- try/catch ở route handler; lỗi không lộ chi tiết nội bộ.

## Architecture

```
ERP ─service key + actingUserEmail─> /api/v1/external/projects/{projectKey}/document-tree
   ├ service-client-authenticator (scope: tree:read, projectKey được phép)
   ├ project_collection_map → collectionId
   ├ user-outline-grant-repository → token user (không có → 409 grantUrl)
   └ outline-api-client (token user) → cây doc của collection
```

## Related Code Files

Tạo `apps/companion/`:
- `app/api/v1/external/projects/[projectKey]/document-tree/route.ts`
- `lib/external/load-project-document-tree-for-user.ts`
- `app/(app)/grant/page.tsx` (trang đích của `grantUrl`: login → lưu grant → báo xong)

Sửa:
- `packages/outline-api-client/src/documents-api.ts` (endpoint lấy cấu trúc cây của collection; tên chính xác tra tài liệu Outline lúc code)
- `apps/companion/lib/external/service-client-authenticator.ts` (thêm scope)
- `docs/third-party-document-api.md`

## Implementation Steps

1. Thêm scope cho service key (`documents:create`, `tree:read`); key cũ mặc định chỉ có `documents:create`.
2. Bổ sung client Outline lấy cây doc của collection bằng token user.
3. `load-project-document-tree-for-user.ts`: mapping → grant → gọi Outline → map sang hợp đồng trả về (bỏ mọi trường nội dung).
4. Route handler: xác thực key, kiểm scope + `projectKey`, validate input (zod), rate limit, audit.
5. Trang `grantUrl`.
6. Test tích hợp với Outline thật: user A (viewer dự án X) thấy cây X; user B không thuộc X → 403; user chưa có grant → 409; key không có scope → 403; không có trường nội dung trong response.
7. Cập nhật `docs/third-party-document-api.md`.

## Todo List

- [ ] Scope cho service key
- [ ] Client Outline lấy cây collection
- [ ] Service nạp cây theo user
- [ ] Route + rate limit + audit
- [ ] Trang cấp grant
- [ ] Integration test phân quyền
- [ ] Cập nhật tài liệu API

## Success Criteria

- ERP gọi với user có quyền → nhận cây đúng cấu trúc Outline, mỗi node có link mở được.
- User không có quyền dự án → 403, không lộ tiêu đề nào.
- Đổi role trong ERP (gỡ khỏi dự án) → sau 1 chu kỳ sync, API trả 403.

## Risk Assessment

- Outline không có endpoint trả cả cây trong 1 lần gọi → duyệt theo nhánh, trả từng cấp theo `parentDocumentId`.
- User phải login companion 1 lần trước khi ERP thấy cây: chấp nhận; nếu ERP không chịu được → xem lại phương án lọc theo dự án bằng token service (cần user quyết, vì nới quy tắc "companion không dùng admin token").
- Email ERP khác email Outline → không tra được grant (câu hỏi mở số 6 ở plan.md).

## Security Considerations

- Chỉ trả id, tiêu đề, link. Không nội dung.
- Scope tách riêng đọc/tạo; key giới hạn theo `projectKey`.
- Token user không rời server, không log.

## Next Steps

- Nếu ERP cần đọc nội dung doc qua API: yêu cầu mới, ngoài phạm vi.
