# Lộ trình phát triển

Sản phẩm không tự viết web UI: Outline (tùy biến bằng config + branding) + 2 service headless (OIDC bridge cho SSO, permission API cho ERP). Tổng 30 ngày công cho 1 dev, không có dự phòng. Luồng nghiệm thu: ERP gọi API tạo node → nhận link → SSO 1 click → user sửa trong Outline.

## Phạm vi chính

| Phase | Tên | Trạng thái | Ngày công | Ghi chú |
|-------|-----|-----------|-----------|---------|
| 1 | Monorepo + hạ tầng Outline | ✓ Hoàn thành | 3d | [phase-01](../plans/261001-0953-outline-plus-companion-document-system/phase-01-monorepo-and-outline-infra.md) |
| 2 | OIDC bridge + SSO token handoff + system_admin local | ✓ Hoàn thành | 8,5d | [phase-02](../plans/261001-0953-outline-plus-companion-document-system/phase-02-oidc-bridge-sso-token-handoff-and-local-system-admin.md) · **Addendum (2026-10-02):** upstream IdP login (OIDC RP, openid-client, PKCE S256, `/upstream/callback`, gate `erp_users`, nút SSO + form admin cùng trang) |
| 3 | Cấu hình + branding Outline, Outline API client | ✓ Hoàn thành | 3d | [phase-03](../plans/261001-0953-outline-plus-companion-document-system/phase-03-outline-config-branding-and-api-client.md) |
| 4 | Permission API: user, dự án, cấp/thu quyền | Pending | 7d | [phase-04](../plans/261001-0953-outline-plus-companion-document-system/phase-04-permission-layer-api-users-projects-and-grants.md) |
| 5 | API tạo node, tác giả là user thật | Pending | 5,5d | [phase-05](../plans/261001-0953-outline-plus-companion-document-system/phase-05-create-node-api-with-real-user-authorship.md) |
| 6 | Rà bảo mật, backup/restore, runbook, tài liệu ERP | Pending | 3d | [phase-06](../plans/261001-0953-outline-plus-companion-document-system/phase-06-testing-hardening-operations-docs.md) |

**Tiến độ:** 2/6 phase (6/30 ngày công, 20%)

## Theo dõi

**Phase 2+ follow-up (2026-10-02 note):**
- Khi upstream IdP chạy ổn: xóa `/sso` handoff route, `ERP_SSO_*` env, CLI `dev:sign-sso-link`, E2E handoff test (viết lại bằng IdP giả).
- Phase 4: provision `erp_users` với `erp_user_id = sub` của IdP (hiện chưa rõ ID nội bộ ERP là gì).

## Hoãn

| Phase | Tên | Trạng thái | Ngày công | Ghi chú |
|-------|-----|-----------|-----------|---------|
| 7 | API cây tài liệu cho bên thứ 3 | Deferred | 2d | [phase-07](../plans/261001-0953-outline-plus-companion-document-system/phase-07-deferred-third-party-document-tree-api.md) |

## Phụ thuộc chính

- Thứ tự: 1 → 2 → 3 → 4 → 5 → 6. Phase 7 chỉ mở khi ERP yêu cầu.
- Phía ERP chưa có: CLI dev ký JWT (phase 2) đóng vai ERP nên không phase nào bị chặn. Nghiệm thu thật cần ERP xác nhận hợp đồng JWT.
- Mỗi phase thử giả định rủi ro nhất ở ngày đầu (không có phase spike).

## Thay đổi phạm vi (2026-10-01, Session 5)

- Bỏ app web companion (Next.js, template → form → doc). Thay bằng permission API headless.
- Đăng nhập user ERP: từ form username/password kiểm qua ERP sang SSO token handoff 1 click. Bỏ `packages/erp-adapters`.
- Quyền: ERP đẩy qua API, áp ngay. Bỏ sync worker và adapter ERP thật.
- Bỏ AI gen khỏi lộ trình.
- Không còn chia MVP 1 / MVP 2. Lộ trình cũ ~49 ngày công → 30 ngày + 2 ngày hoãn.
- Đánh số lại phase (cũ → mới): 2 → 2 · 3 → 3 + 4 · 4 → 5 · 7 → 6 · 10 → 7 · 5, 8, 9 xóa.

## Thay đổi trước đó

- Bỏ phase spike (phase 0) và phase init bộ tài liệu dự án (phase 6 cũ).

Xem [plan.md](../plans/261001-0953-outline-plus-companion-document-system/plan.md) để biết chi tiết, giả định và câu hỏi mở.
