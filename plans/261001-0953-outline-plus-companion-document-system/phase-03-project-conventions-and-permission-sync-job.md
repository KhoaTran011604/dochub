# Phase 03: Quy ước dự án/collection/group + job sync quyền

## Context Links

- [plan.md](./plan.md) · [phase 00](./phase-00-spike-and-risk-verification.md) (S3, S6, S10, S11) · [phase 02](./phase-02-oidc-bridge-local-system-admin-erp-adapter-stub.md)
- [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) mục 3, 4.1
- [research 01](./research/researcher-01-outline-selfhost-and-api.md) mục 4, 5

## Overview

- Ngày: 2026-10-01
- Mô tả: chốt quy ước dự án = collection + 3 group cố định; viết client Outline dùng chung; job push quyền từ `ErpRoleSource` sang Outline bằng admin token, có reconcile định kỳ và log.
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 48h (6 ngày)

## Key Insights

- Outline là mô hình push: không hỏi quyền ra ngoài. Sync job là nguồn duy nhất đưa role ERP vào.
- Group claim qua OIDC (PR #13857) không dùng làm cơ chế chính.
- Chưa có sự kiện từ ERP → chu kỳ reconcile ngắn (mặc định 5 phút, cấu hình được) đóng vai "khi role đổi". Trigger theo sự kiện để phase 8.
- Logic tạo collection + group dùng lại ở phase 6 → đặt trong package, không trong app.
- Nguồn ERP trả rỗng do lỗi có thể xóa sạch quyền → phải có ngưỡng chặn.

## Requirements

Chức năng:
- `packages/outline-api-client`: nơi duy nhất gọi Outline. Nhận token từ caller (admin hoặc user).
- Quy ước: mỗi dự án 1 collection private + group `<projectKey>-viewer|editor|manager` gắn vào collection 1 lần với quyền đọc / đọc-ghi / quản lý (giá trị chính xác theo S10).
- Collection `Templates`: mọi thành viên đọc được; 2 doc gốc `Mẫu tài liệu` (con = template đơn) và `Bộ mẫu dự án` (con = bộ mẫu, phase 6).
- Reconcile: thành viên group khớp `ErpRoleSource`; user `active=false` bị suspend, active lại thì mở.
- Chế độ `--once`, `--dry-run`; vòng lặp định kỳ; log từng hành động.
- CLI đăng ký dự án (tạo collection + group + ghi mapping) để dùng trước khi có UI phase 6.

Phi chức năng:
- Idempotent: chạy lại không tạo trùng, không đổi gì nếu đã khớp.
- Tôn trọng rate limit (S6): tuần tự, backoff theo `Retry-After`.
- Không chạm group/collection ngoài bảng mapping. Không bao giờ suspend `system_admin`.

## Architecture

```
permission-sync-worker (vòng lặp / --once)
  └ packages/project-permission-sync
       ├ ErpRoleSource (stub)            → trạng thái mong muốn
       ├ outline-api-client (admin token)→ trạng thái hiện tại + áp thay đổi
       └ app-database: project_collection_map, sync_runs, sync_actions
```

Luồng mỗi dự án: đọc members ERP → đọc members 3 group → `compute-membership-diff` (hàm thuần) → kiểm ngưỡng an toàn → add/remove → ghi log.

- User chưa có trong Outline: theo S3 (invite trước, hoặc bỏ qua + log `pending_first_login`).
- 1 user chỉ thuộc 1 group/dự án (role cao nhất).
- Khóa chống chạy song song: Postgres advisory lock.
- Ngưỡng an toàn: 1 lần chạy định gỡ > X% thành viên hoặc suspend > N user → dừng, ghi `aborted_safety_threshold`, cần chạy tay với cờ xác nhận.

Bảng (schema `companion`): `project_collection_map(project_key, collection_id, group ids, created_at)`, `sync_runs`, `sync_actions`.

## Related Code Files

Tạo `packages/outline-api-client/src/`:
- `outline-http-client.ts` (fetch, bearer, timeout, retry 429/5xx, lỗi có kiểu)
- `outline-api-types.ts`
- `collections-api.ts`, `groups-api.ts`, `users-api.ts`
- `index.ts`

Tạo `packages/project-permission-sync/src/`:
- `project-group-naming-convention.ts`
- `ensure-project-collection-and-groups.ts`
- `compute-membership-diff.ts`
- `reconcile-project-memberships.ts`
- `reconcile-suspended-users.ts`
- `reconcile-all-projects.ts`
- `sync-safety-threshold-guard.ts`
- `sync-run-repository.ts`
- `project-collection-map-repository.ts`

Tạo `apps/permission-sync-worker/`:
- `src/worker-main.ts` (vòng lặp + cờ CLI)
- `src/register-project-cli.ts`
- `src/environment-config.ts`
- `Dockerfile`

Tạo: `packages/app-database/migrations/0003-create-project-map-and-sync-log-tables.sql`.

Sửa: `infra/docker-compose.yml` (service worker), `infra/.env.example` (`OUTLINE_ADMIN_API_TOKEN`, chu kỳ, ngưỡng).

## Implementation Steps

1. `outline-http-client.ts`: POST `{base}/api/{method}`, parse `{ok, data}`, map lỗi (401/403/404/429/5xx) thành class riêng, retry có giới hạn.
2. Module API theo nhóm, chỉ viết endpoint thật sự dùng (tên + tham số theo S10).
3. Migration 0003.
4. `project-group-naming-convention.ts`: sinh tên group, map role → permission. Validate `projectKey` (ký tự an toàn).
5. `ensure-project-collection-and-groups.ts`: tìm theo mapping → thiếu thì tạo collection private, 3 group, gắn group vào collection, ghi mapping. Chạy lại an toàn.
6. `compute-membership-diff.ts`: hàm thuần, test kỹ (thêm, gỡ, đổi role, email hoa/thường).
7. `reconcile-project-memberships.ts` + `reconcile-suspended-users.ts`, bọc try/catch từng dự án: 1 dự án lỗi không dừng cả lượt.
8. Ngưỡng an toàn + advisory lock + ghi `sync_runs`/`sync_actions`.
9. Worker: `--once`, `--dry-run`, `--project <key>`, `--confirm-large-change`; mặc định lặp theo chu kỳ env.
10. `register-project-cli.ts`.
11. Tạo tay (ghi runbook) collection `Templates` + 2 doc gốc; lưu id vào env/config.
12. Test: unit cho diff + naming + ngưỡng; tích hợp với Outline thật trong compose (stub ERP đổi role → chạy `--once` → kiểm bằng API).

## Todo List

- [ ] `outline-api-client` (http client + collections/groups/users)
- [ ] Migration bảng mapping + log
- [ ] Quy ước tên group + map role
- [ ] `ensure-project-collection-and-groups`
- [ ] Diff thuần + test
- [ ] Reconcile membership + suspend
- [ ] Ngưỡng an toàn + advisory lock + log
- [ ] Worker (loop, once, dry-run) + CLI đăng ký dự án
- [ ] Collection `Templates` + 2 doc gốc
- [ ] Integration test với Outline thật

## Success Criteria

- Đổi role trong stub ERP → sau 1 lượt, quyền trong Outline khớp; user thấy/không thấy collection đúng role.
- User `active=false` → bị suspend, không login được Outline.
- Chạy 2 lần liên tiếp: lần 2 không có hành động nào.
- `--dry-run` không gọi API ghi.
- Stub trả danh sách rỗng → job dừng vì ngưỡng, không gỡ quyền.
- Share doc cha cho user ngoài dự án: thấy mọi con, không thấy gì ngoài nhánh (test tích hợp, dựa S11).

## Risk Assessment

- Admin token lộ = toàn quyền Outline → chỉ worker và companion (server) giữ; xoay vòng theo runbook.
- Sửa tay group trong Outline bị job ghi đè: đúng chủ đích, ghi rõ trong docs.
- Rate limit làm lượt sync dài → log thời lượng, tăng chu kỳ nếu cần.
- User chưa login lần đầu chưa có quyền (nếu S3 fallback) → trễ tối đa 1 chu kỳ sau lần login đầu.

## Security Considerations

- Admin token chỉ qua env, không log. Log hành động không chứa token.
- Email so khớp không phân biệt hoa thường, trim.
- `system_admin` nằm trong danh sách loại trừ cứng của bước suspend.
- Collection dự án mặc định private; quyền chỉ đi qua 3 group.

## Next Steps

- Phase 4 mở rộng `outline-api-client` (documents, auth).
- Phase 6 gọi `ensure-project-collection-and-groups` + reconcile 1 dự án.
- Phase 8: `ErpRoleSource` thật + trigger theo sự kiện.
