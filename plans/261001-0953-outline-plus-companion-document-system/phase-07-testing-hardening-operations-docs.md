# Phase 07: Test, hardening, vận hành, docs

## Context Links

- [plan.md](./plan.md) · các phase 01-06
- [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) mục 5, 7
- `.claude/rules/documentation-management.md` (danh sách file trong `./docs`)

## Overview

- Ngày: 2026-10-01
- Mô tả: test xuyên hệ thống trên Outline thật, rà soát bảo mật, backup/restore có diễn tập, quy trình pin/nâng cấp Outline, bộ docs ban đầu.
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 56h (7 ngày)

## Key Insights

- Unit test viết ngay trong từng phase. Phase này lo phần chỉ kiểm được khi đủ hệ thống: E2E, hợp đồng API, phân quyền, vận hành.
- Không mock Outline cho test hợp đồng/phân quyền: chạy với Outline thật trong compose (đúng quy tắc "không fake để pass").
- 3 tiêu chí bảo mật phải có test tự động: `system_admin` login khi ERP down; companion không lộ doc ngoài quyền; share cha lộ đúng nhánh con.
- Backup chưa restore thử thì coi như chưa có backup.
- Nâng cấp Outline là rủi ro lặp lại → bộ test hợp đồng chính là cổng nâng cấp.

## Requirements

Chức năng:
- Bộ E2E (Playwright) chạy trên compose đầy đủ với ERP stub.
- Test hợp đồng cho mọi endpoint Outline mà `outline-api-client` dùng.
- Backup theo lịch + script restore + biên bản diễn tập.
- Runbook: cài mới, xoay secret, nâng cấp Outline, bridge chết, dọn dự án init hỏng, đổi email user.
- Docs trong `./docs`.

Phi chức năng:
- CI chạy lint + typecheck + unit ở mỗi push; E2E + hợp đồng chạy theo yêu cầu/hàng đêm (cần Docker).
- Không test nào bị bỏ qua để CI xanh.

## Architecture

```
tests/e2e (Playwright) ──> compose: outline + bridge + companion + worker + stub ERP
packages/outline-api-client/contract-tests ──> Outline thật (tag đang pin)
infra/backup: service backup theo lịch → thư mục/đích ngoài máy
```

Quy trình nâng cấp Outline: đọc release notes → backup → đổi tag ở môi trường thử → chạy test hợp đồng + E2E → xanh thì lên production → ghi changelog.

## Related Code Files

Tạo:
- `tests/e2e/playwright.config.ts`
- `tests/e2e/system-admin-login-when-erp-down.spec.ts`
- `tests/e2e/erp-user-single-sign-on.spec.ts`
- `tests/e2e/companion-never-leaks-unreadable-documents.spec.ts`
- `tests/e2e/parent-share-exposes-only-branch.spec.ts`
- `tests/e2e/template-to-document-flow.spec.ts`
- `tests/e2e/project-init-flow.spec.ts`
- `tests/e2e/permission-sync-role-change.spec.ts`
- `tests/e2e/move-document-keeps-inherited-permissions.spec.ts`
- `tests/e2e/fixtures/seed-outline-test-data.ts`
- `packages/outline-api-client/contract-tests/*.contract.test.ts`
- `infra/backup/restore-postgres-databases.sh`
- `infra/backup/restore-minio-bucket.sh`
- `infra/backup/scheduled-backup-entrypoint.sh`
- `infra/docker-compose.production.yml` (override: không publish port nội bộ, restart policy, giới hạn tài nguyên)
- `docs/project-overview-pdr.md`
- `docs/system-architecture.md`
- `docs/code-standards.md`
- `docs/deployment-guide.md`
- `docs/operations-runbook.md`
- `docs/development-roadmap.md`
- `docs/project-changelog.md`
- `docs/third-party-document-api.md`

Sửa: `.github/workflows/ci-lint-typecheck-test.yml` (job E2E theo yêu cầu), `infra/docker-compose.yml` (service backup theo lịch), các app (vá theo kết quả rà soát).

## Implementation Steps

1. Seed dữ liệu test qua API (user stub, dự án, template, doc lồng nhau, share).
2. Viết E2E theo danh sách file ở trên. Kịch bản lộ dữ liệu: gọi trực tiếp từng route companion bằng session user không có quyền, kiểm cả tiêu đề lẫn nội dung.
3. Test hợp đồng: mỗi endpoint 1 test kiểm trường dùng tới (kể cả `url`/`urlId` của `documents.create`, format lỗi, 429).
4. Rà soát bảo mật theo checklist:
   - Header (CSP, HSTS, frame-ancestors), cookie flags, CSRF ở bridge + companion.
   - Rate limit: login bridge, endpoint ngoài, route AI.
   - Secret: không có trong git/log/image; liệt kê + quy trình xoay (admin token, client secret, cookie keys, JWKS, service key, key proxy).
   - `pnpm audit`; pin version; image chạy non-root.
   - Mạng: chỉ reverse proxy mở ra ngoài; Postgres/Redis/MinIO nội bộ.
   - Quyền DB: role app không chạm database `outline`.
   - Rà import admin token: chỉ ở worker và init dự án. Endpoint bên thứ 3 phải dùng token của user (grant), không import admin token.
   - Chạy skill `security-review` + agent `code-reviewer` trên toàn bộ.
5. Backup: lịch hằng ngày (Postgres 2 database + bucket MinIO), giữ N bản, đẩy ra đích ngoài máy (đích theo câu hỏi deploy). Cảnh báo khi backup lỗi (tối thiểu: exit code + log).
6. Diễn tập restore lên môi trường sạch: Outline mở lại được doc + file đính kèm, login qua bridge chạy, companion đọc được mapping. Ghi thời gian + bước vào runbook.
7. Diễn tập nâng cấp Outline 1 bản vá (hoặc cài lại cùng tag) theo quy trình, sửa runbook theo thực tế.
8. Viết docs. `system-architecture.md` có sơ đồ luồng login, sync, tạo doc, AI. `third-party-document-api.md` là hợp đồng cho đội ERP.
9. Đo tiêu chí "tạo doc từ template < 2 phút" với 2-3 người dùng thật, ghi kết quả.
10. Cập nhật roadmap + changelog.

## Todo List

- [ ] Seed dữ liệu test
- [ ] E2E: system_admin khi ERP down
- [ ] E2E: SSO user ERP (stub)
- [ ] E2E: companion không lộ doc ngoài quyền
- [ ] E2E: share cha chỉ lộ nhánh con
- [ ] E2E: move doc giữ quyền kế thừa
- [ ] E2E: template → doc, init dự án, đổi role → sync
- [ ] Test hợp đồng Outline API
- [ ] Rà soát bảo mật + vá
- [ ] Backup theo lịch + đích ngoài máy
- [ ] Diễn tập restore, ghi biên bản
- [ ] Diễn tập quy trình nâng cấp Outline
- [ ] Compose production override
- [ ] Bộ docs trong `./docs`
- [ ] Đo thời gian tạo doc với người dùng thật

## Success Criteria

- Toàn bộ E2E + hợp đồng xanh trên tag Outline đang pin.
- Restore từ backup lên máy sạch thành công, có biên bản.
- Checklist bảo mật không còn mục mở mức cao.
- Người khác đọc `deployment-guide.md` cài được hệ thống từ đầu.
- Mọi tiêu chí thành công ở `plan.md` có test hoặc biên bản đo tương ứng.

## Risk Assessment

- E2E chậm, dễ chập chờn do Outline khởi động lâu → chờ healthcheck, seed qua API, không dựa vào sleep.
- Chưa biết nơi deploy → phần TLS/domain/đích backup trong docs để dạng tham số, hoàn thiện khi có câu trả lời.
- Rà soát phát hiện lỗi thiết kế muộn → vì vậy 3 test bảo mật cốt lõi nên viết sớm ngay khi phase tương ứng xong, phase này chỉ gom lại.

## Security Considerations

- Dữ liệu test là giả; không dùng tài liệu thật trong CI.
- Backup chứa toàn bộ tài liệu + token niêm phong → mã hóa khi lưu ngoài máy, giới hạn người truy cập.
- Runbook xoay secret phải thử ít nhất 1 lần (cookie keys, admin token).
- API key admin break-glass: cất offline, ghi người giữ.

## Next Steps

- Chạy thử với 1 dự án thật, thu phản hồi 2-4 tuần.
- Theo dõi điều kiện xem lại quyết định (brainstorm mục 8).
- Phase 8 khi có contract ERP.
