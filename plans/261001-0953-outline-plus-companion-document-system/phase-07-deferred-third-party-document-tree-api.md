# Phase 07 (hoãn): API cây tài liệu cho bên thứ 3

## Context Links

- [plan.md](./plan.md) · [phase 04](./phase-04-permission-layer-api-users-projects-and-grants.md) (service key, phạm vi dự án) · [phase 05](./phase-05-create-node-api-with-real-user-authorship.md) (grant theo user)

## Overview

- Ngày: 2026-10-01
- Mô tả: endpoint đọc cho ERP lấy cây tài liệu của 1 dự án theo đúng quyền của 1 user (tiêu đề + link, không có nội dung).
- Priority: P3
- Implementation status: Deferred (việc hoãn duy nhất của plan)
- Review status: Chưa review
- Effort: 16h (2 ngày)

## Key Insights

- Lý do hoãn: luồng chính không cần. ERP đã giữ `documentId` + `url` của mọi node nó tạo; cây theo quyền user cần grant của user + thêm 1 nhánh "chưa có grant" → 2 ngày, không rẻ.
- Scope OAuth ở phase 5 là `documents:create auth:read`. Đọc cây bằng token user cần thêm scope `read` → mọi user phải đồng ý lại. Chốt cách làm khi mở phase:
  - (a) token user + scope `read`: Outline ép quyền, đúng cả với quyền mức node; giá = đồng ý lại.
  - (b) admin token + lọc theo role dự án do ERP đã đẩy: không cần đồng ý, nhưng không phản ánh quyền mức node hay share tay trong Outline.

## Requirements

Chức năng:
- `GET /api/v1/projects/{projectKey}/document-tree?actingErpUserId=&parentDocumentId?=`
- `200` cây `{ id, title, url, parentDocumentId, children[] }` · `403` · `409 { grantUrl }` (cách a, chưa có grant).

Phi chức năng:
- Không trả nội dung doc. Giới hạn độ sâu/số node; phân trang theo nhánh cho cây lớn.
- Scope service key mới `tree:read`; key cũ không tự có.
- Rate limit + audit như các endpoint khác.

## Architecture

```
ERP ─service key (tree:read)─> /api/v1/projects/{projectKey}/document-tree
   ├ project_collection_map → collectionId
   ├ (a) grant của user → collections.documents bằng token user
   └ (b) admin token → collections.documents → kiểm role dự án của user
```

## Related Code Files

Tạo `apps/outline-permission-api/src/document-tree/`: `document-tree-routes.ts`, `load-project-document-tree-service.ts`.

Sửa: `packages/outline-api-client/src/collections-api.ts` (`collections.documents`), `src/http/service-key-authentication-middleware.ts` (scope), `docs/erp-integration-guide.md`.

## Implementation Steps

1. Chốt (a) hay (b) với user.
2. Thêm scope `tree:read`.
3. Client: `collections.documents`.
4. Service nạp cây → map sang hợp đồng trả về (bỏ mọi trường nội dung).
5. Route: auth, scope, `projectKey`, zod, rate limit, audit.
6. Test tích hợp: user có quyền thấy cây; user không thuộc dự án → 403; key thiếu scope → 403; response không có trường nội dung.
7. Cập nhật tài liệu ERP.

## Todo List

- [ ] Chốt cách lấy quyền (a/b)
- [ ] Scope `tree:read`
- [ ] Client `collections.documents`
- [ ] Service + route
- [ ] Integration test
- [ ] Tài liệu ERP

## Success Criteria

- ERP gọi với user có quyền → cây đúng cấu trúc Outline, mỗi node có link mở được.
- User không có quyền → 403, không lộ tiêu đề nào.

## Risk Assessment

- Cây lớn → trả theo từng cấp bằng `parentDocumentId`.
- Cách (b) lệch với quyền thật trong Outline → chỉ chọn nếu ERP không dùng quyền mức node.

## Security Considerations

- Chỉ trả id, tiêu đề, link.
- Scope đọc tách khỏi scope ghi; key giới hạn theo `projectKey`.

## Next Steps

- ERP cần đọc nội dung doc qua API: yêu cầu mới, ngoài phạm vi.
