---
title: "Hệ thống tài liệu dự án: Outline + OIDC bridge + Companion"
description: "Self-host Outline, OIDC bridge (ERP + system_admin local), sync quyền push, companion tạo doc từ template/AI, init bộ tài liệu dự án."
status: pending
priority: P2
effort: 440h
branch: develop
tags: [feature, infra, auth, backend, frontend, api]
created: 2026-10-01
---

# Hệ thống tài liệu dự án: Outline + OIDC bridge + Companion

## Tổng quan

Outline lo wiki/editor/quyền/file. Tự viết 3 phần: **OIDC bridge** (đăng nhập ERP + 1 account `system_admin` local), **permission sync** (push quyền ERP → Outline), **companion** (template → form → doc, AI gen, init dự án, endpoint cho bên thứ 3). 1 dev, không deadline cứng, ưu tiên chất lượng.

Nguồn: [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) · [research 01](./research/researcher-01-outline-selfhost-and-api.md) · [research 02](./research/researcher-02-oidc-provider-and-claude-api.md)

## Kiến trúc chốt

```
Browser ─> Outline ──OIDC──> oidc-bridge ──ErpAuthAdapter──> ERP (stub trước)
   │                              └─ system_admin local (argon2id, không qua ERP)
   └────> companion (Next.js) ──OAuth thay mặt user──> Outline API
                 ├─ admin token: chỉ init dự án
                 └─ endpoint bên thứ 3: tạo doc bằng token của user ERP được chỉ định
permission-sync-worker ──ErpRoleSource (stub trước)──> Outline API (admin token)
Claude proxy <── companion (1 module client duy nhất)
```

Layout: `apps/oidc-bridge`, `apps/companion`, `apps/permission-sync-worker`, `packages/outline-api-client`, `packages/erp-adapters`, `packages/project-permission-sync`, `packages/app-database`, `infra/`.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---|---|
| 0 | Spike & kiểm chứng rủi ro | Pending | 40h (5d) | [phase-00](./phase-00-spike-and-risk-verification.md) |
| 1 | Monorepo + hạ tầng Outline | Pending | 24h (3d) | [phase-01](./phase-01-monorepo-and-outline-infra.md) |
| 2 | OIDC bridge + system_admin local + ERP adapter stub | Pending | 64h (8d) | [phase-02](./phase-02-oidc-bridge-local-system-admin-erp-adapter-stub.md) |
| 3 | Quy ước dự án/collection/group + job sync quyền | Pending | 48h (6d) | [phase-03](./phase-03-project-conventions-and-permission-sync-job.md) |
| 4 | Companion: auth, template → form → doc, endpoint bên thứ 3 | Pending | 104h (13d) | [phase-04](./phase-04-companion-auth-template-form-third-party-endpoint.md) |
| 5 | AI gen qua Claude proxy | Pending | 40h (5d) | [phase-05](./phase-05-ai-generation-via-claude-proxy.md) |
| 6 | Init bộ tài liệu dự án | Pending | 32h (4d) | [phase-06](./phase-06-project-document-set-init.md) |
| 7 | Test, hardening, vận hành, docs | Pending | 56h (7d) | [phase-07](./phase-07-testing-hardening-operations-docs.md) |
| 8 | (Hoãn) ERP auth/role adapter thật | Blocked | 32h (4d, ±) | [phase-08](./phase-08-deferred-real-erp-auth-and-role-adapters.md) |

Tổng: 51 ngày công (P0-P7) + 4 ngày hoãn (P8) = **55 ngày ≈ 440h**. Lịch thực tế 1 dev: ~12-14 tuần (đã tính ~20% trượt). Con số 6-7 tuần trong brainstorm là lạc quan: chưa tính sync job, endpoint bên thứ 3, vận hành, test.

## Phụ thuộc chính

- Thứ tự: 0 → 1 → 2 → 3 → 4 → (5, 6) → 7. Phase 8 chạy bất kỳ lúc nào sau phase 3 khi có contract ERP.
- Phase 0 là cổng: kết quả spike có thể đổi thiết kế phase 2/3/4 (xem fallback từng mục).
- Ngoài: Docker, Node (version theo spike), Postgres 16+, Redis 7, MinIO, Outline (pin version có PR #13879), `oidc-provider` 9.x, `@anthropic-ai/sdk`, Claude proxy của user.
- Mọi call Outline đi qua `packages/outline-api-client`. Mọi call AI đi qua 1 module client.
- Giả định phải kiểm ở phase 0: Claude proxy tương thích Anthropic Messages API (`@anthropic-ai/sdk` + `baseURL`), có streaming + prompt caching; Outline OAuth app dùng được trên self-host (không được → fallback ở phase 0/4).

## Tiêu chí thành công (toàn hệ thống)

- User ERP đăng nhập Outline không cần tạo account riêng (1 click khi đã có session bridge).
- `system_admin` đăng nhập được khi ERP API chưa có hoặc đang down.
- Share page cha → người nhận thấy toàn bộ page con, không thấy gì ngoài nhánh.
- Companion không bao giờ trả nội dung doc mà user không đọc được trong Outline.
- Tạo doc chuẩn từ template < 2 phút, style đồng nhất.
- Quyền ERP đổi → Outline khớp sau tối đa 1 chu kỳ reconcile; user nghỉ việc bị suspend.

## Thay đổi so với brainstorm

- Bỏ magic link. `system_admin` = account local trong bridge. Hệ quả: bridge chết thì không ai login Outline (kể cả admin); break-glass còn lại là API key admin cất offline.
- Companion đăng nhập bằng OAuth của Outline (1 luồng vừa định danh vừa lấy token thay mặt user), không làm OIDC client riêng của bridge trừ khi phải fallback.

## Câu hỏi chưa giải quyết

1. Contract ERP: API login/verify JWT và API role (project → members/roles); có webhook khi role đổi không; có cách chuyển session ERP sang bridge để login 1 click thật không.
2. Chính sách + ngân sách gửi nội dung tài liệu ra Claude qua proxy (loại doc nào được gửi, hạn mức token/người/ngày).
3. Nơi deploy (on-prem/cloud), domain, TLS (ai cấp cert, có reverse proxy sẵn chưa).
4. SMTP: chỉ cần cho thông báo của Outline. Có sẵn chưa, hay chạy không email?
5. Proxy (đã xác nhận theo Messages API): có hỗ trợ streaming, prompt caching, tham số `thinking`/`output_config`, beta header không? → kiểm ở S12.
6. ERP định danh user bằng gì khi gọi endpoint bên thứ 3 (email có trùng email trong Outline không)?

## Validation Log

### Session 1 — 2026-10-01
**Trigger:** validate lần đầu sau khi tạo plan.
**Questions asked:** 6

#### Questions & Answers

1. **[Scope]** API của ERP chưa có. Trong lúc chờ, user thường (không phải system_admin) đăng nhập bằng cách nào?
   - Options: Chờ ERP, chỉ system_admin (Recommended) | User local tạm trong bridge | Go-live chờ ERP xong hẳn
   - **Answer:** Chờ ERP, chỉ system_admin
   - **Rationale:** không dựng hệ thống user thứ hai; trước phase 8 production chạy chế độ `none` (chỉ system_admin), stub chỉ cho dev/test.

2. **[Architecture]** Companion đăng nhập theo cách nào? (planner đã đổi so với brief ban đầu)
   - Options: OAuth của Outline (Recommended) | OIDC của bridge
   - **Answer:** OAuth của Outline
   - **Rationale:** 1 luồng cho cả định danh và token thay mặt user; phụ thuộc S5.

3. **[Risk]** Khi bridge chết thì không ai login được Outline, kể cả system_admin. Break-glass thế nào?
   - Options: API key admin cất offline (Recommended) | Thêm magic link cho admin | Không cần
   - **Answer:** API key admin cất offline
   - **Rationale:** không cần SMTP, không thêm đường đăng nhập; phase 7 phải có runbook + nơi cất key.

4. **[Assumptions]** Claude proxy của bạn dùng định dạng API nào?
   - Options: Anthropic Messages API | OpenAI-compatible | Chưa rõ
   - **Answer:** Anthropic Messages API
   - **Rationale:** chốt `@anthropic-ai/sdk` + `baseURL`; S12 thu hẹp còn kiểm streaming/caching/tham số.

5. **[Scope]** Ai kích hoạt việc init bộ tài liệu cho một dự án mới?
   - Options: Admin bấm trong companion (Recommended) | ERP gọi tự động | Cả hai
   - **Answer:** Admin bấm trong companion
   - **Rationale:** phase 6 không cần endpoint init cho ERP.

6. **[Architecture]** Doc do ERP tạo qua endpoint bên thứ 3 sẽ ghi tác giả là ai?
   - Options: Account service riêng (Recommended) | Account admin | User ERP thật
   - **Answer:** User ERP thật
   - **Rationale:** endpoint không dùng admin token được; cần grant OAuth theo user (refresh token lưu niêm phong) và nhánh `pendingUrl` khi user chưa cấp quyền. Phức tạp hơn phương án khuyến nghị, +3 ngày công.

#### Confirmed Decisions
- Trước ERP: chỉ system_admin login production — tránh hệ user tạm.
- Companion login = OAuth Outline — phụ thuộc S5.
- Break-glass = API key admin offline.
- Proxy = Anthropic Messages API.
- Init dự án = admin bấm trong companion.
- Tác giả doc từ ERP = user ERP thật — qua grant theo user, fallback link tạo-khi-mở.

#### Action Items
- [x] Phase 4: thiết kế lại endpoint bên thứ 3 (actingUserEmail, 201/202, grant, pending request), effort 10d → 13d
- [x] Phase 0: S5 kiểm thêm refresh token offline; S12 ghi nhận định dạng đã xác nhận
- [x] Phase 5: giả định proxy → đã xác nhận
- [ ] Phase 7: runbook break-glass (nơi cất API key admin, cách dùng) — kiểm khi làm phase 7

#### Impact on Phases
- Phase 0: S5 thêm kiểm refresh token offline + tác giả hiển thị; S12 thu hẹp phạm vi.
- Phase 4: endpoint bên thứ 3 tạo doc bằng token user ERP; thêm 2 bảng, trang pending, +24h.
- Phase 5: proxy Messages API đã xác nhận.
