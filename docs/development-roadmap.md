# Lộ trình phát triển

Dự án gồm 2 MVP. MVP 1 (~30 ngày công) xây hạ tầng Outline tự host, OIDC bridge, companion template. MVP 2 AI gen, sync quyền, ERP thật.

## MVP 1

| Phase | Tên | Trạng thái | Ngày công | Ghi chú |
|-------|-----|-----------|-----------|---------|
| 1 | Monorepo + hạ tầng Outline | ✓ Hoàn thành | 3d | [phase-01](../plans/261001-0953-outline-plus-companion-document-system/phase-01-monorepo-and-outline-infra.md) |
| 2 | OIDC bridge + system_admin local | Pending | 8d | [phase-02](../plans/261001-0953-outline-plus-companion-document-system/phase-02-oidc-bridge-local-system-admin-erp-adapter-stub.md) |
| 3 | Outline API client + quy ước dự án | Pending | 2d | [phase-03](../plans/261001-0953-outline-plus-companion-document-system/phase-03-project-conventions-and-permission-sync-job.md) |
| 4 | Companion: auth, template → form → doc | Pending | 13d | [phase-04](../plans/261001-0953-outline-plus-companion-document-system/phase-04-companion-auth-template-form-third-party-endpoint.md) |
| 7 | Test cốt lõi, backup, runbook, docs | Pending | 3d | [phase-07](../plans/261001-0953-outline-plus-companion-document-system/phase-07-testing-hardening-operations-docs.md) |

**MVP 1 Progress:** 1/5 (20%)

## MVP 2 (Hoãn)

| Phase | Tên | Trạng thái | Ngày công | Ghi chú |
|-------|-----|-----------|-----------|---------|
| 9 | Job sync quyền ERP → Outline | Deferred | 4d | [phase-09](../plans/261001-0953-outline-plus-companion-document-system/phase-09-permission-sync-worker.md) |
| 8 | ERP auth/role adapter thật | Blocked | 4d | [phase-08](../plans/261001-0953-outline-plus-companion-document-system/phase-08-deferred-real-erp-auth-and-role-adapters.md) |
| 10 | API cây tài liệu cho bên thứ 3 | Deferred | 2d | [phase-10](../plans/261001-0953-outline-plus-companion-document-system/phase-10-third-party-document-tree-api.md) |
| 5 | AI gen qua Claude proxy | Deferred | 5d | [phase-05](../plans/261001-0953-outline-plus-companion-document-system/phase-05-ai-generation-via-claude-proxy.md) |
| 7b | Hardening còn lại (test hợp đồng, docs đầy đủ) | Deferred | 4d | [phase-07 § Hoãn](../plans/261001-0953-outline-plus-companion-document-system/phase-07-testing-hardening-operations-docs.md#hoãn-sang-mvp-2) |

**MVP 2 Progress:** 0/5 (0%)

## Phụ thuộc chính

- MVP 1: 1 → 2 → 3 → 4 → 7  
- MVP 2: 9 → 8 → 10 → 5 → 7b  
- Phase 8 phụ thuộc ERP contract; chưa có thì làm 5 trước.

## Thay đổi so với kế hoạch ban đầu

- Bỏ phase spike (phase 0): làm theo giả định, không kiểm chứng trước.
- Bỏ phase 6 (init bộ tài liệu dự án): thay bằng CLI `register-project` ở phase 3.
- Phase 5 (AI gen) → MVP 2.
- Job sync quyền → MVP 2 (phase 9).
- Phase 7 rút còn 3 ngày; phần còn lại → MVP 2 (7b).

Xem [plan.md](../plans/261001-0953-outline-plus-companion-document-system/plan.md) để biết chi tiết.
