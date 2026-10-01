# Phase 08 (hoãn): ERP auth/role adapter thật

## Context Links

- [plan.md](./plan.md) (câu hỏi mở số 1) · [phase 02](./phase-02-oidc-bridge-local-system-admin-erp-adapter-stub.md) · [phase 03](./phase-03-project-conventions-and-permission-sync-job.md)
- Contract ERP: CHƯA CÓ. Phase bị chặn tới khi nhận được.

## Overview

- Ngày: 2026-10-01
- Mô tả: thay stub bằng adapter gọi API ERP thật cho đăng nhập và role; thêm trigger sync theo sự kiện nếu ERP có.
- Priority: P1 khi có contract (không có phase này thì user ERP chưa dùng được production)
- Implementation status: Blocked (chờ contract ERP)
- Review status: Chưa review
- Effort: 32h (4 ngày), ước lượng thô; chốt lại khi đọc contract

## Key Insights

- Toàn bộ thay đổi gói trong `packages/erp-adapters` + cấu hình env. Bridge và sync không sửa logic (đó là lý do có interface từ phase 2).
- ERP dùng JWT: adapter gọi API login của ERP bằng username/password, nhận JWT, lấy profile. Bridge không lưu JWT của ERP.
- `system_admin` không đổi, vẫn không qua ERP.
- Login 1 click thật (không nhập lại mật khẩu khi đang có session ERP) cần ERP chuyển được token sang bridge. Chỉ làm nếu contract cho phép và user yêu cầu.

## Requirements

Chức năng:
- `HttpErpAuthAdapter` cài `ErpAuthAdapter`: map lỗi ERP → `invalid_credentials | inactive | unavailable`.
- `HttpErpRoleSource` cài `ErpRoleSource`: `listProjects`, `listProjectMembers`, `listUsers`; map role ERP → `viewer | editor | manager`.
- Chọn bằng env `ERP_AUTH_ADAPTER=http`, `ERP_ROLE_SOURCE=http`.
- (Nếu ERP có webhook) endpoint nhận sự kiện role đổi → chạy reconcile cho 1 dự án.

Phi chức năng:
- Timeout + retry có giới hạn; ERP down không làm treo bridge, không làm sync gỡ quyền (ngưỡng an toàn phase 3 + coi lỗi nguồn là "bỏ lượt").
- Phân trang nếu ERP phân trang.

## Architecture

```
bridge ─ ErpAuthAdapter(http) ──> ERP login/verify API
worker ─ ErpRoleSource(http) ───> ERP role API (service credential)
ERP ─webhook (tùy chọn)─> companion /api/v1/external/role-changed ─> reconcile(projectKey)
```

Bảng map role ERP → role dự án đặt trong config (không hardcode trong logic).

## Related Code Files

Tạo `packages/erp-adapters/src/`:
- `http-erp-auth-adapter.ts`
- `http-erp-role-source.ts`
- `erp-http-client.ts` (timeout, retry, auth service-to-service)
- `map-erp-role-to-project-role.ts`

Tạo (tùy chọn, nếu có webhook): `apps/companion/app/api/v1/external/role-changed/route.ts`.

Sửa: `packages/erp-adapters/src/create-erp-adapters-from-env.ts`, `infra/.env.example`, `docs/deployment-guide.md`, `docs/operations-runbook.md`.

## Implementation Steps

1. Đọc contract; đối chiếu với 2 interface. Thiếu trường (ví dụ không có `erpUserId` ổn định, không có danh sách user active) → hỏi lại đội ERP trước khi code.
2. `erp-http-client.ts` + 2 adapter; test hợp đồng với môi trường thử của ERP.
3. Bảng map role; xử lý role lạ: bỏ qua + cảnh báo, không gán quyền mặc định.
4. Đổi env ở môi trường thử: login user ERP thật; chạy sync `--dry-run`, xem diff trước khi áp.
5. Chuyển user stub → user thật: kiểm `sub` + email khớp để không tạo user trùng trong Outline (theo S3/S8).
6. (Tùy chọn) endpoint webhook, dùng lại xác thực service key + idempotency phase 4.
7. Chạy lại E2E phase 7 với ERP thử; cập nhật docs.

## Todo List

- [ ] Nhận + rà contract ERP
- [ ] `HttpErpAuthAdapter` + test
- [ ] `HttpErpRoleSource` + map role + test
- [ ] Dry-run sync với dữ liệu ERP thật, duyệt diff
- [ ] Kế hoạch chuyển user (tránh trùng)
- [ ] (Tùy chọn) trigger theo sự kiện
- [ ] Chạy lại E2E, cập nhật docs

## Success Criteria

- User ERP thật login Outline + companion, không tạo account riêng.
- Đổi role trong ERP → Outline khớp trong 1 chu kỳ (hoặc tức thì nếu có webhook).
- Tắt ERP: `system_admin` vẫn login; user ERP nhận thông báo rõ; sync bỏ lượt, không gỡ quyền.
- Không sửa dòng nào trong logic bridge/sync ngoài factory + config.

## Risk Assessment

- Contract không khớp interface (không có password login mà chỉ SSO redirect, không liệt kê được member) → sửa interface, ảnh hưởng ngược phase 2/3; đó là rủi ro lớn nhất của cả plan, cần lấy contract càng sớm càng tốt.
- ERP không có định danh user ổn định → `sub` phải dựa email, đổi email sẽ tạo user mới.
- Dữ liệu role ERP bẩn → dry-run + duyệt diff trước lần áp đầu.

## Security Considerations

- Password user chỉ đi qua bridge tới ERP bằng TLS, không lưu, không log.
- Credential service gọi API role: quyền chỉ đọc, lưu env, xoay được.
- Verify chữ ký/hạn JWT của ERP nếu bridge phải đọc claim từ đó (dùng thư viện, không tự viết).
- Webhook: xác thực + chống phát lại.

## Next Steps

- Tắt adapter stub ở mọi môi trường không phải dev.
- Xem xét login 1 click thật nếu ERP hỗ trợ chuyển token.
