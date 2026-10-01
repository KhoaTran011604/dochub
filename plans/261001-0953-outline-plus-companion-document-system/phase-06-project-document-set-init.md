# Phase 06: Init bộ tài liệu dự án

## Context Links

- [plan.md](./plan.md) · [phase 03](./phase-03-project-conventions-and-permission-sync-job.md) · [phase 04](./phase-04-companion-auth-template-form-third-party-endpoint.md)
- [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) mục 4.2

## Overview

- Ngày: 2026-10-01
- Mô tả: admin chọn 1 "bộ mẫu dự án" → companion tạo collection + 3 group + cây doc khởi tạo, rồi chạy sync quyền cho dự án đó.
- Priority: P2
- Implementation status: Pending
- Review status: Chưa review
- Effort: 32h (4 ngày)

## Key Insights

- Bộ mẫu soạn ngay trong Outline (DRY, không cần editor): mỗi doc con của `Bộ mẫu dự án` là 1 bộ; cây con của nó là cây doc sẽ được sao.
- Placeholder trong các doc của bộ mẫu được gom thành 1 form cấp dự án (tên, mã dự án, ...), dùng lại parser + form động phase 4.
- Tạo collection + group đã có ở phase 3 (`ensure-project-collection-and-groups`), không viết lại.
- Dùng admin token (tạo collection, group). Chỉ admin Outline mới vào được màn này.
- Tạo nhiều doc tuần tự có thể lỗi giữa chừng → phải chạy tiếp được, không tạo trùng.

## Requirements

Chức năng:
- Liệt kê bộ mẫu; xem trước cây doc.
- Form: `projectKey`, tên dự án, giá trị placeholder gom từ cả bộ.
- Thực thi: đăng ký dự án → sao cây (giữ thứ tự, cấp cha-con) → reconcile quyền dự án → trả link collection.
- Theo dõi tiến độ; lỗi giữa chừng → "Chạy tiếp" từ node chưa tạo.

Phi chức năng:
- Idempotent theo `projectKey` + node nguồn.
- Tôn trọng rate limit (tuần tự, backoff có sẵn trong client).
- Không rollback tự động (KISS): dọn tay theo runbook nếu muốn hủy.

## Architecture

```
Admin UI ─POST /api/projects/init─> project-init-service (admin token)
   1 ensure-project-collection-and-groups        (phase 3)
   2 duyệt cây bộ mẫu theo chiều rộng
        mỗi node: merge placeholder → documents.create(parentDocumentId = id đã map)
        ghi project_init_nodes(run_id, source_doc_id, created_doc_id)
   3 reconcile-project-memberships(projectKey)   (phase 3)
UI poll GET /api/projects/init/[runId] → trạng thái + số node xong
```

Bảng (schema `companion`): `project_init_runs(id, project_key, template_set_doc_id, status, error, started_by)`, `project_init_nodes`.

Chạy trong route handler của Next.js self-host (tiến trình Node sống lâu); cây điển hình vài chục doc. Nếu sau này cây lớn → chuyển sang worker (chưa cần).

## Related Code Files

Tạo `apps/companion/`:
- `lib/projects/list-project-template-sets.ts`
- `lib/projects/load-template-set-document-tree.ts`
- `lib/projects/collect-placeholders-from-template-set.ts`
- `lib/projects/project-init-service.ts`
- `lib/projects/project-init-run-repository.ts`
- `lib/auth/require-outline-admin.ts`
- `app/api/projects/template-sets/route.ts`
- `app/api/projects/init/route.ts`
- `app/api/projects/init/[runId]/route.ts`
- `app/(app)/projects/new/page.tsx`
- `components/template-set-tree-preview.tsx`
- `components/project-init-progress.tsx`
- `queries/projects/queries.ts`, `queries/projects/mutations.ts`

Tạo: `packages/app-database/migrations/0006-create-project-init-run-tables.sql`.

Sửa: `apps/companion/queries/query-keys.ts`, `apps/companion/package.json` (thêm dependency `project-permission-sync`).

## Implementation Steps

1. Migration 0006.
2. `require-outline-admin.ts`: kiểm role từ session (lấy lại `auth.info` khi vào màn admin, không tin cache cũ).
3. Liệt kê bộ mẫu + nạp cây (id, title, thứ tự, text).
4. Gom placeholder toàn bộ → dùng `build-form-schema-from-placeholders` + `dynamic-placeholder-form`.
5. `project-init-service.ts`: 3 bước như sơ đồ; mỗi node bọc try/catch, ghi trạng thái; gọi lại với cùng run → bỏ qua node đã có trong `project_init_nodes`.
6. Kiểm trước khi chạy: `projectKey` hợp lệ, chưa có mapping (hoặc là run đang dở của chính nó).
7. Route + UI: trang tạo dự án, preview cây, tiến độ, nút chạy tiếp, link mở collection.
8. Ghi audit (ai init, bộ mẫu nào, kết quả).
9. Test: unit (gom placeholder, thứ tự duyệt cây, resume); tích hợp: init dự án từ bộ mẫu thật 3 cấp → kiểm cây + group + quyền; mô phỏng lỗi ở node giữa → chạy tiếp → không trùng.

## Todo List

- [ ] Migration bảng run + node
- [ ] Guard admin
- [ ] Liệt kê bộ mẫu + nạp cây
- [ ] Gom placeholder cấp dự án
- [ ] Service init (ensure → sao cây → reconcile) có resume
- [ ] Route + UI tạo dự án + tiến độ
- [ ] Audit
- [ ] Unit + integration test

## Success Criteria

- Init 1 dự án: collection private + 3 group + cây doc đúng cấu trúc bộ mẫu, placeholder đã thay.
- Thành viên trong stub ERP thấy collection đúng role ngay sau init (không chờ chu kỳ).
- User không phải admin: không thấy màn, route trả 403.
- Lỗi giữa chừng rồi chạy tiếp: không doc trùng, run kết thúc `completed`.
- Init lại cùng `projectKey` đã xong → bị từ chối rõ ràng.

## Risk Assessment

- `projectKey` trong companion lệch với ERP → sync không khớp. Giảm thiểu: chọn từ `ErpRoleSource.listProjects()` thay vì gõ tay.
- Thứ tự doc anh em sau khi tạo qua API có thể không giữ: kiểm khi làm; nếu lệch → tạo theo thứ tự ngược hoặc dùng `documents.move` (kiểm chứng trước khi dùng).
- Bộ mẫu bị sửa trong lúc init → chụp cây 1 lần đầu run, dùng bản chụp.
- Request dài bị proxy ngắt → UI dựa vào poll trạng thái, không dựa vào response POST.

## Security Considerations

- Chỉ admin Outline; kiểm ở server, không chỉ ẩn nút.
- Admin token trong companion chỉ dùng ở `project-init-service` (ngoài ra chỉ có sync worker phase 3). Endpoint bên thứ 3 dùng token của user, không dùng admin token.
- Validate `projectKey` (chống tên group/collection độc hại).
- Audit đầy đủ.

## Next Steps

- Đã chốt ở Validation Session 1 (plan.md, câu 5): init do admin bấm trong companion. Nếu sau này ERP cần tự kích hoạt init → thêm endpoint ngoài gọi cùng service (không làm trước khi được yêu cầu).
- Phase 7: E2E init dự án + runbook dọn dự án init hỏng.
