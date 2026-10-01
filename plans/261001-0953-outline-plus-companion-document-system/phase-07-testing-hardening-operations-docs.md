# Phase 07: Test cốt lõi, backup, runbook, docs tối thiểu

## Context Links

- [plan.md](./plan.md) · các phase 01-04
- [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) mục 5, 7
- `.claude/rules/documentation-management.md` (danh sách file trong `./docs`)

## Overview

- Ngày: 2026-10-01
- Mô tả: phần tối thiểu để MVP 1 chạy thật được: 3 test bảo mật cốt lõi trên Outline thật, backup có restore thử, runbook break-glass, hướng dẫn deploy. Phần còn lại hoãn sang MVP 2 (mục cuối file).
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 24h (3 ngày)

## Key Insights

- Unit test viết ngay trong từng phase. Phase này chỉ lo phần kiểm được khi đủ hệ thống.
- Không mock Outline cho test phân quyền: chạy với Outline thật trong compose.
- 3 tiêu chí bảo mật phải có test tự động: `system_admin` login khi ERP down; companion không lộ doc ngoài quyền; share cha lộ đúng nhánh con.
- Backup chưa restore thử thì coi như chưa có backup.

## Requirements

Chức năng:
- 4 E2E (Playwright) trên compose đầy đủ với ERP stub.
- Backup theo lịch + script restore + 1 lần diễn tập.
- Runbook: cài mới, bridge chết (break-glass), xoay secret, gán thành viên group bằng tay.
- Docs tối thiểu trong `./docs`.

Phi chức năng:
- CI chạy lint + typecheck + unit ở mỗi push; E2E chạy theo yêu cầu (cần Docker).
- Không test nào bị bỏ qua để CI xanh.

## Architecture

```
tests/e2e (Playwright) ──> compose: outline + bridge + companion + stub ERP
infra/backup: service backup theo lịch → thư mục/đích ngoài máy
```

## Related Code Files

Tạo:
- `tests/e2e/playwright.config.ts`
- `tests/e2e/fixtures/seed-outline-test-data.ts`
- `tests/e2e/system-admin-login-when-erp-down.spec.ts`
- `tests/e2e/companion-never-leaks-unreadable-documents.spec.ts`
- `tests/e2e/parent-share-exposes-only-branch.spec.ts`
- `tests/e2e/template-to-document-flow.spec.ts`
- `infra/backup/restore-postgres-databases.sh`
- `infra/backup/restore-minio-bucket.sh`
- `infra/backup/scheduled-backup-entrypoint.sh`
- `infra/docker-compose.production.yml` (override: không publish port nội bộ, restart policy)
- `docs/deployment-guide.md`
- `docs/operations-runbook.md`
- `docs/third-party-document-api.md`
- `docs/development-roadmap.md`
- `docs/project-changelog.md`

Sửa: `.github/workflows/ci-lint-typecheck-test.yml` (job E2E theo yêu cầu), `infra/docker-compose.yml` (service backup theo lịch), các app (vá theo kết quả rà soát).

## Implementation Steps

1. Seed dữ liệu test qua API (user stub, dự án, template, doc lồng nhau, share).
2. 4 E2E theo danh sách. Kịch bản lộ dữ liệu: gọi trực tiếp từng route companion bằng session user không có quyền, kiểm cả tiêu đề lẫn nội dung.
3. Rà soát bảo mật nhanh:
   - Cookie flags, CSRF ở bridge + companion; rate limit login bridge + endpoint ngoài.
   - Secret: không có trong git/log/image.
   - Mạng: Postgres/Redis/MinIO không publish ra ngoài; role app không chạm database `outline`.
   - Rà import admin token: chỉ ở CLI đăng ký dự án. Endpoint bên thứ 3 dùng token user (grant).
   - Chạy skill `security-review` + agent `code-reviewer`; vá mục mức cao.
4. Backup: lịch hằng ngày (Postgres 2 database + bucket MinIO), giữ N bản. Lỗi → exit code + log.
5. Diễn tập restore lên môi trường sạch: Outline mở lại được doc + file đính kèm, login qua bridge chạy. Ghi bước vào runbook.
6. Viết `deployment-guide.md`, `operations-runbook.md` (break-glass: nơi cất API key admin, cách dùng), `third-party-document-api.md` (hợp đồng cho đội ERP).
7. Cập nhật roadmap + changelog.

## Todo List

- [ ] Seed dữ liệu test
- [ ] E2E: system_admin khi ERP down
- [ ] E2E: companion không lộ doc ngoài quyền
- [ ] E2E: share cha chỉ lộ nhánh con
- [ ] E2E: template → doc
- [ ] Rà soát bảo mật nhanh + vá mức cao
- [ ] Backup theo lịch
- [ ] Diễn tập restore, ghi runbook
- [ ] Compose production override
- [ ] Docs: deployment guide, runbook (break-glass), API bên thứ 3, roadmap, changelog

## Success Criteria

- 4 E2E xanh trên tag Outline đang pin.
- Restore từ backup lên máy sạch thành công.
- Không còn mục bảo mật mở mức cao.
- Người khác đọc `deployment-guide.md` cài được hệ thống từ đầu.

## Risk Assessment

- 3 ngày rất sát: nếu phase trước trượt, giữ thứ tự ưu tiên test bảo mật → backup/restore → docs.
- E2E chập chờn do Outline khởi động lâu → chờ healthcheck, seed qua API, không dựa vào sleep.
- Chưa biết nơi deploy → phần TLS/domain/đích backup trong docs để dạng tham số.

## Security Considerations

- Dữ liệu test là giả; không dùng tài liệu thật trong CI.
- Backup chứa toàn bộ tài liệu + token niêm phong → mã hóa khi lưu ngoài máy, giới hạn người truy cập.
- API key admin break-glass: cất offline, ghi người giữ.

## Hoãn sang MVP 2

Ước lượng 32h (4 ngày), làm sau phase 5/8/9:

- Test hợp đồng cho mọi endpoint `outline-api-client` dùng (`packages/outline-api-client/contract-tests/`).
- E2E: SSO user ERP, move doc giữ quyền kế thừa, đổi role → sync (đi cùng phase 9).
- Diễn tập quy trình nâng cấp Outline (đọc release notes → backup → đổi tag ở môi trường thử → test → production).
- Rà soát bảo mật đầy đủ: header (CSP, HSTS, frame-ancestors), `pnpm audit`, image non-root, quy trình xoay toàn bộ secret có thử, rate limit route AI.
- Đẩy backup ra đích ngoài máy + cảnh báo khi lỗi.
- Docs: `project-overview-pdr.md`, `system-architecture.md`, `code-standards.md`.
- Đo "tạo doc từ template < 2 phút" với 2-3 người dùng thật.

## Next Steps

- Chạy thử với 1 dự án thật, thu phản hồi.
- MVP 2: phase 9 → phase 8 (khi có contract ERP), phase 5, phần hoãn ở trên.
