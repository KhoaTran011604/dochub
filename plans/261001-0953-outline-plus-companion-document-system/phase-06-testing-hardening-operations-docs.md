# Phase 06: Rà bảo mật, backup/restore, runbook, tài liệu tích hợp ERP

## Context Links

- [plan.md](./plan.md) · các phase 01-05
- [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) mục 5, 7
- `.claude/rules/documentation-management.md` (danh sách file trong `./docs`)

## Overview

- Ngày: 2026-10-01
- Mô tả: phần tối thiểu để chạy thật: rà bảo mật, backup có restore thử, runbook, hướng dẫn deploy, và tài liệu tích hợp cho đội ERP (thứ đội ERP cần để làm phần của họ).
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 24h (3 ngày)

## Key Insights

- Unit + integration + 2 E2E đã viết trong phase 2-5. Phase này không viết thêm bộ test mới, chỉ chạy lại toàn bộ trên compose sạch.
- Giữ Playwright với đúng 2 spec (chuỗi SSO, chuỗi đồng ý): cả hai đi qua 3 origin + JS phía client của Outline, test bằng `fetch` không mô phỏng được. Không thêm spec khác.
- Backup chưa restore thử thì coi như chưa có backup.
- Phía ERP chưa tồn tại → tài liệu tích hợp + CLI dev ký link là thứ thay thế để nghiệm thu.

## Requirements

Chức năng:
- Rà bảo mật nhanh + vá mục mức cao.
- Backup theo lịch + script restore + 1 lần diễn tập.
- Compose production override.
- Docs trong `./docs`: deployment guide, runbook, tài liệu tích hợp ERP, system architecture, code standards; cập nhật roadmap + changelog.

Phi chức năng:
- CI: lint + typecheck + unit mỗi push; integration + E2E chạy theo yêu cầu (cần Docker).
- Không test nào bị bỏ qua để CI xanh.

## Architecture

```
infra/backup: service backup theo lịch → pg_dump 2 database + tar.gz file storage → thư mục/đích ngoài máy
docs/erp-integration-guide.md: hợp đồng JWT + dựng link SSO + permission API + create-node API + xử lý 202
```

## Related Code Files

Tạo:
- `infra/backup/restore-postgres-databases.sh`
- `infra/backup/restore-outline-file-storage.sh`
- `infra/backup/scheduled-backup-entrypoint.sh`
- `infra/docker-compose.production.yml` (không publish port nội bộ, restart policy, `NODE_ENV=production`)
- `docs/deployment-guide.md`
- `docs/operations-runbook.md`
- `docs/erp-integration-guide.md`
- `docs/system-architecture.md`
- `docs/code-standards.md`

Sửa: `.github/workflows/ci-lint-typecheck-test.yml` (job integration + E2E theo yêu cầu), `infra/docker-compose.yml` (service backup theo lịch), `docs/development-roadmap.md`, `docs/project-changelog.md`, các app (vá theo kết quả rà soát).

## Implementation Steps

1. Chạy toàn bộ test trên compose dựng từ volume trống; sửa cái hỏng.
2. Rà bảo mật:
   - Bridge: thuật toán JWT, replay, `returnTo`, Referer, cookie flags, CSRF form, lockout, token không vào log (kể cả log reverse proxy cho `/sso`).
   - Permission API: service key, phạm vi dự án ở mọi endpoint, giới hạn body, rate limit, `system_admin` không bị đụng, token niêm phong.
   - Hạ tầng: Postgres/Redis không publish; Outline bind 127.0.0.1; role DB tách; secret không có trong git/log/image; image chạy non-root.
   - Header: HSTS, `frame-ancestors`, `Referrer-Policy`.
   - `pnpm audit`; skill `security-review` + agent `code-reviewer`; vá mục mức cao.
3. Backup hằng ngày, giữ N bản; lỗi → exit code + log.
4. Diễn tập restore lên môi trường sạch: mở lại được doc + file đính kèm, SSO chạy, grant OAuth còn dùng được. Ghi bước vào runbook.
5. `operations-runbook.md`: cài mới theo thứ tự; bridge chết (break-glass: nơi cất API key admin, cách dùng); xoay secret (JWKS bridge, khóa ERP, service key, `TOKEN_SEAL_PASSWORD`, admin token); lệch đồng hồ; user vào nhầm phiên người khác; quy tắc không move doc có share riêng; nâng cấp Outline (đọc release notes → backup → đổi tag ở môi trường thử → chạy test → production).
6. `erp-integration-guide.md`: hợp đồng JWT, ai dựng link và dựng lúc nào (ký tại thời điểm click), yêu cầu Referer, thứ tự gọi (provision user → cấp quyền → tạo node → bọc link), xử lý `202`, mã lỗi, rate limit, ví dụ `curl` + ví dụ ký JWT.
7. `deployment-guide.md` (TLS/domain/đích backup để dạng tham số tới khi chốt nơi deploy), `system-architecture.md`, `code-standards.md`.
8. Cập nhật roadmap + changelog.

## Todo List

- [ ] Chạy lại toàn bộ test trên compose sạch
- [ ] Rà bảo mật + vá mức cao
- [ ] Backup theo lịch
- [ ] Diễn tập restore, ghi runbook
- [ ] Compose production override
- [ ] Runbook vận hành
- [ ] Tài liệu tích hợp ERP
- [ ] Deployment guide, system architecture, code standards
- [ ] Roadmap + changelog

## Success Criteria

- Toàn bộ test xanh trên tag Outline đang pin.
- Restore từ backup lên máy sạch thành công.
- Không còn mục bảo mật mở mức cao.
- Người khác đọc `deployment-guide.md` cài được hệ thống từ đầu.
- Dev ERP chỉ đọc `erp-integration-guide.md` là gọi được trọn luồng trên môi trường thử.

## Risk Assessment

- Không còn dự phòng lịch: phase trước trượt → giữ thứ tự ưu tiên rà bảo mật → backup/restore → tài liệu ERP → docs còn lại.
- E2E chập chờn do Outline khởi động lâu → chờ healthcheck, seed qua API, không `sleep`.
- Chưa biết nơi deploy → TLS/domain để dạng tham số.

## Security Considerations

- Dữ liệu test là giả.
- Backup chứa toàn bộ tài liệu + token niêm phong → mã hóa khi lưu ngoài máy, giới hạn người truy cập.
- API key admin break-glass: cất offline, ghi người giữ.

## Next Steps

- Nghiệm thu với đội ERP trên môi trường thử.
- Việc hoãn duy nhất: [phase 07](./phase-07-deferred-third-party-document-tree-api.md).
