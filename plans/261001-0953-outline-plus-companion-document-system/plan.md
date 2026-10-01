---
title: "Hệ thống tài liệu dự án: Outline + OIDC bridge + Companion"
description: "MVP 1 (30 ngày công): self-host Outline, OIDC bridge (system_admin local + ERP stub), quy ước dự án, companion tạo doc từ template + endpoint bên thứ 3. MVP 2: AI gen, sync quyền, ERP thật."
status: pending
priority: P2
effort: 232h
branch: develop
tags: [feature, infra, auth, backend, frontend, api]
created: 2026-10-01
---

# Hệ thống tài liệu dự án: Outline + OIDC bridge + Companion

## Tổng quan

Outline lo wiki/editor/quyền/file. Tự viết: **OIDC bridge** (đăng nhập ERP + 1 account `system_admin` local), **companion** (template → form → doc, endpoint cho bên thứ 3). 1 dev, **ngân sách MVP 1 = 30 ngày công**. Không có phase spike: làm theo giả định từ research, sai đâu lấy fallback ghi trong từng phase.

Hoãn sang MVP 2: AI gen, job sync quyền ERP → Outline, adapter ERP thật, phần hardening còn lại. Đã bỏ hẳn: phase spike, init bộ tài liệu dự án.

Tổng hợp 1 file (công việc, spec, kiến trúc, stack): [project-brief](./project-brief-tasks-spec-architecture-and-locked-stack.md)

Nguồn: [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) · [research 01](./research/researcher-01-outline-selfhost-and-api.md) · [research 02](./research/researcher-02-oidc-provider-and-claude-api.md)

## Kiến trúc chốt (MVP 1)

```
Browser ─> Outline ──OIDC──> oidc-bridge ──ErpAuthAdapter──> ERP (stub; thật ở MVP 2)
   │                              └─ system_admin local (argon2id, không qua ERP)
   └────> companion (Next.js) ──OAuth thay mặt user──> Outline API
                 └─ endpoint bên thứ 3: tạo doc bằng token của user ERP được chỉ định
register-project CLI (admin token) ──> Outline API: collection + 3 group cho mỗi dự án
```

MVP 2 thêm: `permission-sync-worker ──ErpRoleSource──> Outline API`, `companion ──> Claude proxy`.

Layout MVP 1: `apps/oidc-bridge`, `apps/companion`, `packages/outline-api-client`, `packages/erp-adapters`, `packages/project-permission-sync`, `packages/app-database`, `infra/`. MVP 2 thêm `apps/permission-sync-worker`.

## Phases

### MVP 1 (29 ngày công + 1 ngày dự phòng)

| # | Phase | Status | Effort | Link |
|---|---|---|---|---|
| 1 | Monorepo + hạ tầng Outline | Pending | 24h (3d) | [phase-01](./phase-01-monorepo-and-outline-infra.md) |
| 2 | OIDC bridge + system_admin local + ERP auth stub | Pending | 64h (8d) | [phase-02](./phase-02-oidc-bridge-local-system-admin-erp-adapter-stub.md) |
| 3 | Outline API client + quy ước dự án/collection/group | Pending | 16h (2d) | [phase-03](./phase-03-project-conventions-and-permission-sync-job.md) |
| 4 | Companion: auth, template → form → doc, endpoint bên thứ 3 | Pending | 104h (13d) | [phase-04](./phase-04-companion-auth-template-form-third-party-endpoint.md) |
| 7 | Test cốt lõi, backup, runbook, docs tối thiểu | Pending | 24h (3d) | [phase-07](./phase-07-testing-hardening-operations-docs.md) |

### MVP 2 (hoãn, ~19 ngày công; bảng theo thứ tự làm)

| # | Phase | Status | Effort | Link |
|---|---|---|---|---|
| 9 | Job sync quyền ERP → Outline | Deferred | 32h (4d) | [phase-09](./phase-09-permission-sync-worker.md) |
| 8 | ERP auth/role adapter thật | Blocked | 32h (4d, ±) | [phase-08](./phase-08-deferred-real-erp-auth-and-role-adapters.md) |
| 10 | API cây tài liệu cho bên thứ 3 | Deferred | 16h (2d) | [phase-10](./phase-10-third-party-document-tree-api.md) |
| 5 | AI gen qua Claude proxy | Deferred | 40h (5d) | [phase-05](./phase-05-ai-generation-via-claude-proxy.md) |
| 7b | Hardening còn lại (test hợp đồng, diễn tập nâng cấp, docs đầy đủ) | Deferred | 32h (4d) | [phase-07 § Hoãn](./phase-07-testing-hardening-operations-docs.md#hoãn-sang-mvp-2) |

## Phụ thuộc chính

- MVP 1: 1 → 2 → 3 → 4 → 7. MVP 2: 9 → 8 → 10 → 5 → 7b. Phase 8 cần contract ERP; chưa có thì làm 5 trước.
- Luồng ERP đầy đủ (tạo node qua API → link → user ERP vào Outline sửa → chỉ thấy cây được phân quyền) chạy thật sau khi xong 9 + 8 + 10. Endpoint tạo node đã có từ phase 4.
- Ngoài: Docker, Node (theo `engines` của `oidc-provider`), Postgres 16+, Redis 7, MinIO, Outline (pin tag stable có PR #13879), `oidc-provider` 9.x.
- Mọi call Outline đi qua `packages/outline-api-client`.

## Rủi ro lịch (do bỏ spike)

- Dự phòng chỉ 1 ngày. 2 giả định có thể phá lịch: OAuth app của Outline dùng được trên self-host (sai → phase 4 +2-6 ngày), `oidc-provider` 9.x chạy đúng như tài liệu (sai → phase 2 phải plan lại).
- Gặp 1 trong 2 → dừng, báo user, cắt endpoint bên thứ 3 (≈5 ngày) sang MVP 2 để bù.

## Tiêu chí thành công

MVP 1:
- `system_admin` đăng nhập Outline được khi ERP API chưa có hoặc đang down; user stub đăng nhập được ở dev.
- Share page cha → người nhận thấy toàn bộ page con, không thấy gì ngoài nhánh.
- Companion không bao giờ trả nội dung doc mà user không đọc được trong Outline.
- Tạo doc chuẩn từ template < 2 phút, style đồng nhất.
- Restore từ backup lên máy sạch thành công.

MVP 2:
- User ERP thật đăng nhập Outline không cần tạo account riêng.
- Quyền ERP đổi → Outline khớp sau tối đa 1 chu kỳ reconcile; user nghỉ việc bị suspend.

## Thay đổi so với brainstorm

- Bỏ magic link. `system_admin` = account local trong bridge. Hệ quả: bridge chết thì không ai login Outline (kể cả admin); break-glass còn lại là API key admin cất offline.
- Companion đăng nhập bằng OAuth của Outline (1 luồng vừa định danh vừa lấy token thay mặt user), không làm OIDC client riêng của bridge trừ khi phải fallback.
- MVP 1 gán thành viên vào 3 group của dự án bằng tay trong Outline (chưa có sync).

## Câu hỏi chưa giải quyết

1. Contract ERP: API login/verify JWT và API role (project → members/roles); có webhook khi role đổi không; có cách chuyển session ERP sang bridge để login 1 click thật không.
2. Chính sách + ngân sách gửi nội dung tài liệu ra Claude qua proxy (MVP 2).
3. Nơi deploy (on-prem/cloud), domain, TLS (ai cấp cert, có reverse proxy sẵn chưa).
4. SMTP: chỉ cần cho thông báo của Outline. Có sẵn chưa, hay chạy không email?
5. Proxy: có hỗ trợ streaming, prompt caching, tham số `thinking`/`output_config`, beta header không? → kiểm khi làm phase 5 (MVP 2).
6. ERP định danh user bằng gì khi gọi endpoint bên thứ 3 (email có trùng email trong Outline không)?
7. Trước phase 8 production chỉ `system_admin` login được → endpoint bên thứ 3 (cần grant của user ERP) chưa dùng được thật ở MVP 1. Vẫn giữ trong MVP 1 hay dời sang MVP 2 để có ~6 ngày dự phòng?

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
   - **Rationale:** 1 luồng cho cả định danh và token thay mặt user.

3. **[Risk]** Khi bridge chết thì không ai login được Outline, kể cả system_admin. Break-glass thế nào?
   - Options: API key admin cất offline (Recommended) | Thêm magic link cho admin | Không cần
   - **Answer:** API key admin cất offline
   - **Rationale:** không cần SMTP, không thêm đường đăng nhập; phase 7 phải có runbook + nơi cất key.

4. **[Assumptions]** Claude proxy của bạn dùng định dạng API nào?
   - Options: Anthropic Messages API | OpenAI-compatible | Chưa rõ
   - **Answer:** Anthropic Messages API
   - **Rationale:** chốt `@anthropic-ai/sdk` + `baseURL`.

5. **[Scope]** Ai kích hoạt việc init bộ tài liệu cho một dự án mới?
   - **Answer:** Admin bấm trong companion — **đã thay thế ở Session 2: bỏ tính năng init.**

6. **[Architecture]** Doc do ERP tạo qua endpoint bên thứ 3 sẽ ghi tác giả là ai?
   - Options: Account service riêng (Recommended) | Account admin | User ERP thật
   - **Answer:** User ERP thật
   - **Rationale:** endpoint không dùng admin token được; cần grant OAuth theo user (refresh token lưu niêm phong) và nhánh `pendingUrl` khi user chưa cấp quyền. +3 ngày công.

### Session 2 — 2026-10-01
**Trigger:** user cắt phạm vi, ngân sách 30 ngày công.

#### Confirmed Decisions
- Bỏ phase 0 (spike): không kiểm chứng trước, làm theo giả định; xóa file phase-00.
- Bỏ phase 6 (init bộ tài liệu dự án): xóa file phase-06. Đăng ký dự án bằng CLI phase 3.
- Phase 5 (AI gen) → MVP 2.
- Job sync quyền → MVP 2 (phase 9 mới, tách từ phase 3). Phase 3 còn 2 ngày.
- Phase 7 rút còn 3 ngày; phần còn lại → MVP 2 (7b).
- Endpoint bên thứ 3 giữ ở MVP 1.

#### Impact on Phases
- Phase 1, 2, 4: bỏ tham chiếu spike, thay bằng giả định + fallback tại chỗ.
- Phase 2: `ErpRoleSource` + stub role chuyển sang phase 9.
- Phase 3: chỉ còn client + quy ước + CLI; thành viên group gán tay.
- Phase 7: 3 test bảo mật cốt lõi, backup/restore, runbook, docs tối thiểu.
- Phase 8: phụ thuộc phase 9.

### Session 3 — 2026-10-01
**Trigger:** user chốt thứ tự MVP 2 + yêu cầu API cây tài liệu cho bên thứ 3.

#### Confirmed Decisions
- MVP 2 làm phase 9 + 8 đầu tiên (khi ERP hỗ trợ auth/role), để luồng ERP tạo node → link → sửa trong Outline dùng được thật.
- Thêm phase 10: API cây tài liệu, bên thứ 3 chỉ thấy cây user được phân quyền bên ERP.
