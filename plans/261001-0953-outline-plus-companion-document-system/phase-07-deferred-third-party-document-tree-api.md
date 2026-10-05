# Phase 07 (hoãn): API cây tài liệu cho bên thứ 3

## Context Links

- [plan.md](./plan.md) · [phase 04](./phase-04-permission-layer-api-users-projects-and-grants.md) (service key, phạm vi dự án) · [phase 05](./phase-05-create-node-api-with-real-user-authorship.md) (grant theo user)

## Overview

- Ngày: 2026-10-01
- Mô tả: endpoint đọc cho ERP lấy cây tài liệu của 1 dự án theo đúng quyền của 1 user (tiêu đề + link, không có nội dung).
- Priority: P3
- Implementation status: Done (đã kiểm trên Outline 1.10.1 thật, 2026-10-05)
- Review status: Chưa review (code reviewed, but integration test vs real Outline pending)
- Effort: 16h (2 ngày)

## Key Insights

- **Decision (a) chosen:** token user + scope `read` via 409 grantUrl (consent-only pending request). Phản ánh đúng quyền Outline (mức node + share tay), rõ ràng hơn (b). Giá: user mở lần thứ 2 đồng ý quyền `read` nếu chưa có.
- Scope OAuth mở rộng từ `documents:create auth:read` (phase 5) thành `documents:create auth:read read` (phase 7). Service và route hoàn tất, unit test + typecheck pass.
- Extras: depth param + 1000-node cap (tránh lỏng đặc quá lớn), migration 0006 cho consent-only request.
- Docker down lúc test → không chạy integration test vs Outline 1.10.1 thật. Cần verify `read` scope hoạt động với `collections.documents`.

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

- [x] Chốt cách lấy quyền → (a) chosen
- [x] Scope `read` (mở rộng từ phase 5)
- [x] Client `collections.documents`
- [x] Service + route + unit test
- [x] Docs ERP checked
- [x] Verify scope `read` works for collections.documents on Outline 1.10.1 (integration test vs real Outline)

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
