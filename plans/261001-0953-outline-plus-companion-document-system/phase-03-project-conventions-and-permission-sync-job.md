# Phase 03: Outline API client + quy ước dự án/collection/group

## Context Links

- [plan.md](./plan.md) · [phase 02](./phase-02-oidc-bridge-local-system-admin-erp-adapter-stub.md)
- [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) mục 3, 4.1
- [research 01](./research/researcher-01-outline-selfhost-and-api.md) mục 4, 5
- Phần job sync quyền đã tách sang [phase 09](./phase-09-permission-sync-worker.md) (MVP 2).

## Overview

- Ngày: 2026-10-01
- Mô tả: viết client Outline dùng chung; chốt quy ước dự án = collection private + 3 group cố định; CLI đăng ký dự án bằng admin token. Chưa có sync: thành viên group gán tay trong Outline.
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 16h (2 ngày)

## Key Insights

- Trước khi có ERP thật, production chỉ `system_admin` login → job sync chưa có dữ liệu thật để chạy. MVP 1 chỉ cần khung dự án đúng quy ước để MVP 2 gắn sync vào không phải đổi cấu trúc.
- Logic tạo collection + group đặt trong package (phase 9 dùng lại), không trong app.
- Endpoint bên thứ 3 ở phase 4 cần bảng mapping `projectKey → collectionId` → bảng này làm ở đây.

## Giả định (chưa kiểm chứng)

- Tên endpoint theo tài liệu Outline: `collections.create`, `groups.create`, `collections.add_group`. Tên/tham số khác thực tế → sửa trong đúng module API, ghi lại.
- Giá trị permission khi gắn group vào collection: lấy theo tài liệu API lúc code, không đoán.
- Rate limit: không đo trước; client chạy tuần tự + backoff theo `Retry-After`.

## Requirements

Chức năng:
- `packages/outline-api-client`: nơi duy nhất gọi Outline. Nhận token từ caller (admin hoặc user).
- Quy ước: mỗi dự án 1 collection private + group `<projectKey>-viewer|editor|manager` gắn vào collection 1 lần với quyền đọc / đọc-ghi / quản lý.
- CLI đăng ký dự án: tạo collection + 3 group + ghi mapping.
- Collection `Templates`: mọi thành viên đọc được; 1 doc gốc `Mẫu tài liệu` (con = template).

Phi chức năng:
- Idempotent: chạy lại CLI cùng `projectKey` không tạo trùng.
- Không chạm group/collection ngoài bảng mapping.

## Architecture

```
register-project-cli (admin token)
  └ packages/project-permission-sync
       ├ ensure-project-collection-and-groups ─> outline-api-client ─> Outline
       └ app-database: project_collection_map
```

Bảng (schema `companion`): `project_collection_map(project_key, collection_id, group ids, created_at)`.

Gán thành viên: admin thêm user vào 3 group bằng giao diện Outline (ghi vào runbook). Tự động hóa ở phase 9.

## Related Code Files

Tạo `packages/outline-api-client/src/`:
- `outline-http-client.ts` (fetch, bearer, timeout, retry 429/5xx, lỗi có kiểu)
- `outline-api-types.ts`
- `collections-api.ts`, `groups-api.ts`
- `index.ts`

Tạo `packages/project-permission-sync/src/`:
- `project-group-naming-convention.ts`
- `ensure-project-collection-and-groups.ts`
- `project-collection-map-repository.ts`
- `register-project-cli.ts`

Tạo: `packages/app-database/migrations/0003-create-project-collection-map-table.sql`.

Sửa: `infra/.env.example` (`OUTLINE_ADMIN_API_TOKEN`).

## Implementation Steps

1. `outline-http-client.ts`: POST `{base}/api/{method}`, parse `{ok, data}`, map lỗi (401/403/404/429/5xx) thành class riêng, retry có giới hạn.
2. `collections-api.ts`, `groups-api.ts`: chỉ viết endpoint thật sự dùng.
3. Migration 0003.
4. `project-group-naming-convention.ts`: sinh tên group, map role → permission. Validate `projectKey` (ký tự an toàn).
5. `ensure-project-collection-and-groups.ts`: tìm theo mapping → thiếu thì tạo collection private, 3 group, gắn group vào collection, ghi mapping. Chạy lại an toàn.
6. `register-project-cli.ts`: nhận `--project-key`, `--name`; bọc try/catch, in kết quả rõ.
7. Tạo tay (ghi runbook) collection `Templates` + doc gốc `Mẫu tài liệu`; lưu id vào env/config.
8. Test: unit cho naming + validate; tích hợp với Outline thật trong compose (chạy CLI 2 lần → 1 collection, 3 group).

## Todo List

- [ ] `outline-api-client` (http client + collections/groups)
- [ ] Migration bảng mapping
- [ ] Quy ước tên group + map role
- [ ] `ensure-project-collection-and-groups`
- [ ] CLI đăng ký dự án
- [ ] Collection `Templates` + doc gốc
- [ ] Unit + integration test

## Success Criteria

- Chạy CLI → collection private + 3 group gắn đúng quyền + 1 dòng mapping.
- Chạy lại cùng `projectKey`: không tạo thêm gì.
- User (stub) được thêm tay vào group `viewer` → thấy collection, không sửa được.

## Risk Assessment

- Admin token lộ = toàn quyền Outline → chỉ dùng ở CLI, qua env, không log.
- Gán tay sai group: chấp nhận ở MVP 1; phase 9 sẽ ghi đè theo ERP.
- Endpoint Outline khác tài liệu → phát hiện ở test tích hợp bước 8.

## Security Considerations

- Admin token chỉ qua env, không log.
- Collection dự án mặc định private; quyền chỉ đi qua 3 group.
- Validate `projectKey` (chống tên group/collection độc hại).

## Next Steps

- Phase 4 mở rộng `outline-api-client` (documents, auth) và dùng bảng mapping cho endpoint bên thứ 3.
- Phase 9 (MVP 2): job sync quyền dùng lại `ensure-project-collection-and-groups`.
