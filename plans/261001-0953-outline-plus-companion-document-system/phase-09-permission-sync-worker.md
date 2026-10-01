# Phase 09 (MVP 2): Job sync quyền ERP → Outline

## Context Links

- [plan.md](./plan.md) · [phase 03](./phase-03-project-conventions-and-permission-sync-job.md) (client + quy ước + mapping) · [phase 08](./phase-08-deferred-real-erp-auth-and-role-adapters.md)
- [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) mục 3, 4.1
- [research 01](./research/researcher-01-outline-selfhost-and-api.md) mục 4, 5

## Overview

- Ngày: 2026-10-01
- Mô tả: job push quyền từ `ErpRoleSource` sang Outline bằng admin token, có reconcile định kỳ, ngưỡng an toàn và log. Tách từ phase 3 khi cắt phạm vi MVP 1.
- Priority: P2 (P1 khi có contract ERP)
- Implementation status: Deferred (MVP 2)
- Review status: Chưa review
- Effort: 32h (4 ngày)

## Key Insights

- Outline là mô hình push: không hỏi quyền ra ngoài. Sync job là nguồn duy nhất đưa role ERP vào.
- Group claim qua OIDC (PR #13857) không dùng làm cơ chế chính.
- Chưa có sự kiện từ ERP → chu kỳ reconcile ngắn (mặc định 5 phút, cấu hình được). Trigger theo sự kiện để phase 8.
- Nguồn ERP trả rỗng do lỗi có thể xóa sạch quyền → phải có ngưỡng chặn.
- Job sẽ ghi đè thành viên group đã gán tay ở MVP 1: lần chạy đầu bắt buộc `--dry-run` + duyệt diff.

## Requirements

Chức năng:
- Interface `ErpRoleSource` + stub trong `packages/erp-adapters`.
- Reconcile: thành viên 3 group mỗi dự án khớp `ErpRoleSource`; user `active=false` bị suspend, active lại thì mở.
- Chế độ `--once`, `--dry-run`, `--project <key>`, `--confirm-large-change`; vòng lặp định kỳ; log từng hành động.

Phi chức năng:
- Idempotent: chạy lại không đổi gì nếu đã khớp.
- Tuần tự, backoff theo `Retry-After`.
- Không chạm group/collection ngoài bảng mapping. Không bao giờ suspend `system_admin`.

## Architecture

```
permission-sync-worker (vòng lặp / --once)
  └ packages/project-permission-sync
       ├ ErpRoleSource (stub → http ở phase 8) → trạng thái mong muốn
       ├ outline-api-client (admin token)      → trạng thái hiện tại + áp thay đổi
       └ app-database: project_collection_map (phase 3), sync_runs, sync_actions
```

```ts
type ProjectRole = 'viewer' | 'editor' | 'manager';
interface ErpRoleSource {
  listProjects(): Promise<{ projectKey: string; name: string }[]>;
  listProjectMembers(projectKey: string): Promise<{ email: string; role: ProjectRole }[]>;
  listUsers(): Promise<{ email: string; active: boolean }[]>;
}
```

Luồng mỗi dự án: đọc members ERP → đọc members 3 group → `compute-membership-diff` (hàm thuần) → kiểm ngưỡng an toàn → add/remove → ghi log.

- User chưa có trong Outline: bỏ qua + log `pending_first_login`, chu kỳ sau áp quyền.
- 1 user chỉ thuộc 1 group/dự án (role cao nhất).
- Khóa chống chạy song song: Postgres advisory lock.
- Ngưỡng an toàn: 1 lần chạy định gỡ > X% thành viên hoặc suspend > N user → dừng, ghi `aborted_safety_threshold`, cần chạy tay với cờ xác nhận.

## Related Code Files

Tạo `packages/erp-adapters/src/`: `erp-role-source.ts`, `stub-erp-role-source.ts`; thêm dự án + thành viên vào fixture dev.

Tạo `packages/outline-api-client/src/users-api.ts`; bổ sung `groups-api.ts` (list/add/remove member).

Tạo `packages/project-permission-sync/src/`:
- `compute-membership-diff.ts`
- `reconcile-project-memberships.ts`
- `reconcile-suspended-users.ts`
- `reconcile-all-projects.ts`
- `sync-safety-threshold-guard.ts`
- `sync-run-repository.ts`

Tạo `apps/permission-sync-worker/`: `src/worker-main.ts`, `src/environment-config.ts`, `Dockerfile`.

Tạo: migration kế tiếp trong `packages/app-database/migrations/` cho `sync_runs`, `sync_actions`.

Sửa: `packages/erp-adapters/src/create-erp-adapters-from-env.ts`, `infra/docker-compose.yml` (service worker), `infra/.env.example` (chu kỳ, ngưỡng).

## Implementation Steps

1. `ErpRoleSource` + stub + factory (từ chối stub ở production).
2. `users-api.ts` + bổ sung group membership API.
3. Migration bảng log.
4. `compute-membership-diff.ts`: hàm thuần, test kỹ (thêm, gỡ, đổi role, email hoa/thường).
5. `reconcile-project-memberships.ts` + `reconcile-suspended-users.ts`, bọc try/catch từng dự án: 1 dự án lỗi không dừng cả lượt.
6. Ngưỡng an toàn + advisory lock + ghi `sync_runs`/`sync_actions`.
7. Worker: cờ CLI + vòng lặp theo chu kỳ env.
8. Test: unit cho diff + ngưỡng; tích hợp với Outline thật (stub đổi role → `--once` → kiểm bằng API).
9. E2E `permission-sync-role-change` (đã hoãn từ phase 7).

## Todo List

- [ ] `ErpRoleSource` + stub
- [ ] API users + group membership
- [ ] Migration bảng log
- [ ] Diff thuần + test
- [ ] Reconcile membership + suspend
- [ ] Ngưỡng an toàn + advisory lock + log
- [ ] Worker (loop, once, dry-run)
- [ ] Integration + E2E test

## Success Criteria

- Đổi role trong stub ERP → sau 1 lượt, quyền trong Outline khớp.
- User `active=false` → bị suspend, không login được Outline.
- Chạy 2 lần liên tiếp: lần 2 không có hành động nào.
- `--dry-run` không gọi API ghi.
- Stub trả danh sách rỗng → job dừng vì ngưỡng, không gỡ quyền.

## Risk Assessment

- Lần chạy đầu gỡ quyền đã gán tay ở MVP 1 → dry-run + duyệt diff trước.
- Sửa tay group trong Outline bị job ghi đè: đúng chủ đích, ghi rõ trong docs.
- Rate limit làm lượt sync dài → log thời lượng, tăng chu kỳ nếu cần.

## Security Considerations

- Admin token chỉ qua env, không log.
- Email so khớp không phân biệt hoa thường, trim.
- `system_admin` nằm trong danh sách loại trừ cứng của bước suspend.

## Next Steps

- Phase 8: `ErpRoleSource` thật + trigger theo sự kiện.
