---
title: "Hệ thống tài liệu dự án: Outline + OIDC bridge (SSO) + Permission API"
description: "Không tự viết UI. Outline tùy biến bằng config; OIDC bridge cho SSO 1 click từ ERP; permission API headless để ERP đẩy quyền và tạo node, user vào Outline sửa. 30 ngày công, không còn dự phòng."
status: pending
priority: P2
effort: 240h
branch: develop
tags: [feature, infra, auth, sso, backend, api, permissions]
created: 2026-10-01
---

# Hệ thống tài liệu dự án: Outline + OIDC bridge (SSO) + Permission API

## Tổng quan

Outline lo wiki/editor/quyền/file, tùy biến chỉ bằng env + team settings (image chính thức pin `1.10.1` + digest, không fork). Tự viết 2 service headless, **không có web UI riêng**:

1. **oidc-bridge**: IdP duy nhất của Outline. User ERP vào bằng link 1 click (JWT ngắn hạn do ERP ký); `system_admin` local (form argon2id) làm đường admin / break-glass.
2. **outline-permission-api**: ERP đẩy user + quyền (dự án, từng node) và tạo node doc; service áp vào Outline ngay.

Luồng chính (tiêu chí số 1): ERP gọi API tạo node → nhận link → bọc link bằng SSO → user 1 click → đứng trong Outline, sửa văn bản bình thường.

1 dev. Không có phase spike: mỗi phase thử giả định rủi ro nhất ngay ngày đầu, sai thì lấy fallback ghi tại chỗ.

Tổng hợp 1 file: [project-brief](./project-brief-tasks-spec-architecture-and-locked-stack.md)

Nguồn: [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) · research [01](./research/researcher-01-outline-selfhost-and-api.md) · [02](./research/researcher-02-oidc-provider-and-claude-api.md) · [03](./research/researcher-03-sso-token-handoff-into-oidc-bridge.md) · [04](./research/researcher-04-outline-permission-api-user-provisioning-and-branding.md). Research 03/04 có chỗ sai (`setProviderSession`, `@josesuite/node`, nhiều mục ASSUMED): lệch với phase file thì phase file đúng (đã đối chiếu source Outline `v1.10.1`).

## Kiến trúc chốt

```
ERP (server) ── service key ──> outline-permission-api ── admin token ──> Outline API
                                  │  PUT users / projects / members        (cấp, thu quyền)
                                  └─ POST documents ── token OAuth của user ──> documents.create
                                       → 201 { url } | 202 { pendingUrl }

ERP (trình duyệt) ── {bridge}/sso?token=<jwt>&returnTo=<url> ──> oidc-bridge
                                  │ verify JWT, 1 lần, đặt handoff        └─ system_admin: form argon2id
                                  └─ 302 ──> Outline ──OIDC──> oidc-bridge (tự hoàn tất) ──> doc
```

Layout: `apps/oidc-bridge`, `apps/outline-permission-api`, `packages/outline-api-client`, `packages/outline-workspace-setup`, `packages/app-database`, `infra/`, `tests/e2e` (2 spec).

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---|---|
| 1 | Monorepo + hạ tầng Outline | Done | 24h (3d) | [phase-01](./phase-01-monorepo-and-outline-infra.md) |
| 2 | OIDC bridge + SSO token handoff + system_admin local | Pending | 68h (8,5d) | [phase-02](./phase-02-oidc-bridge-sso-token-handoff-and-local-system-admin.md) |
| 3 | Cấu hình + branding Outline, Outline API client | Pending | 24h (3d) | [phase-03](./phase-03-outline-config-branding-and-api-client.md) |
| 4 | Permission API: user, dự án, cấp/thu quyền | Pending | 56h (7d) | [phase-04](./phase-04-permission-layer-api-users-projects-and-grants.md) |
| 5 | API tạo node, tác giả là user thật | Pending | 44h (5,5d) | [phase-05](./phase-05-create-node-api-with-real-user-authorship.md) |
| 6 | Rà bảo mật, backup/restore, runbook, tài liệu ERP | Pending | 24h (3d) | [phase-06](./phase-06-testing-hardening-operations-docs.md) |
| 7 | API cây tài liệu cho bên thứ 3 | Deferred | 16h (2d) | [phase-07](./phase-07-deferred-third-party-document-tree-api.md) |

**Tổng 1-6: 240h = 30 ngày công** (đã xong 24h, còn 216h = 27 ngày). Bằng đúng ngân sách MVP 1 cũ (29 ngày + 1 dự phòng) nhưng **không còn ngày dự phòng nào**. Toàn lộ trình giảm từ ~49 ngày (MVP 1 + MVP 2 cũ) xuống 30 ngày + 2 ngày hoãn. UI companion bị bỏ, nhưng API đẩy quyền (trước nằm ở MVP 2 dưới dạng sync worker + adapter ERP) và SSO handoff vào phạm vi chính.

Muốn có dự phòng: đổi tác giả doc sang service account → phase 5 còn ~14h, tiết kiệm ~30h (3,75 ngày). Chi tiết: phase-05, mục "Cái giá của tác giả thật".

## Phụ thuộc chính

- Thứ tự: 1 → 2 → 3 → 4 → 5 → 6. Phase 7 chỉ mở khi ERP yêu cầu.
- Phía ERP chưa có: CLI dev ký JWT (phase 2) đóng vai ERP → không phase nào bị chặn. Nghiệm thu thật cần ERP xác nhận hợp đồng JWT.
- Ngoài: Docker, Node 22, Postgres 16 (glibc), Redis 7, Outline `1.10.1`, `oidc-provider` 9.x, `jose`, Koa.
- Mọi call Outline đi qua `packages/outline-api-client`.

## Rủi ro lịch

- Không có dự phòng. 3 giả định có thể phá lịch, đều thử ở ngày đầu của phase tương ứng: `oidc-provider` + handoff chạy trọn luồng với Outline (phase 2); `users.invite` không SMTP + khớp account ở lần SSO đầu (phase 4); OAuth của Outline chạy trên self-host (phase 5).
- Trượt → dừng, báo user. Đòn bẩy cắt: tác giả service account (−30h), bỏ quyền mức node (−4h), bỏ script team settings và đặt tay (−5h).

## Tiêu chí thành công

- **Luồng chính:** gọi API tạo node → link → bọc SSO → 1 click → user đứng trong doc mới ở Outline, sửa được; tác giả là chính user. Chạy được bằng CLI dev trước khi ERP có.
- SSO: không mật khẩu, không thấy màn login Outline hay form bridge; token replay/hết hạn/sai chữ ký không đăng nhập được.
- `system_admin` login được khi không có ERP.
- ERP cấp role dự án hoặc quyền 1 node → user thấy và sửa được đúng phần đó, không thấy gì ngoài; thu quyền / deactivate có hiệu lực ngay.
- Outline hiện đúng tên, logo, ngôn ngữ; chỉ còn đường đăng nhập qua bridge; member không mời người, không share công khai.
- Restore từ backup lên máy sạch thành công.

## Thay đổi so với plan trước (Session 5)

- Bỏ `apps/companion` (Next.js, React, shadcn, TanStack Query, template → form → doc). Thay bằng `apps/outline-permission-api` headless.
- Bỏ form username/password kiểm qua ERP + `packages/erp-adapters`. Thay bằng SSO token handoff.
- Bỏ khỏi lộ trình: AI gen, sync worker kéo quyền, adapter ERP thật. Quyền do ERP đẩy qua API.
- Đánh số lại phase (cũ → mới): 2 → 2 (viết lại) · 3 → 3 + 4 · 4 → 5 (chỉ còn endpoint) · 7 → 6 · 10 → 7 (hoãn) · 5, 8, 9 xóa.
- File phase đã xóa: `phase-02-oidc-bridge-local-system-admin-erp-adapter-stub`, `phase-03-project-conventions-and-permission-sync-job`, `phase-04-companion-auth-template-form-third-party-endpoint`, `phase-05-ai-generation-via-claude-proxy`, `phase-07-testing-hardening-operations-docs`, `phase-08-deferred-real-erp-auth-and-role-adapters`, `phase-09-permission-sync-worker`, `phase-10-third-party-document-tree-api`.
- Schema Postgres `companion` → `permission_api` (migration 0002, schema còn rỗng). Tách role DB cho 2 service.
- Giữ nguyên: `system_admin` local, break-glass bằng API key admin cất offline, quy ước 1 dự án = 1 collection private + 3 group.

## Giả định mặc định (user có thể lật lại)

- Bỏ tính năng template → form → doc. API tạo node nhận `title` + `text` markdown (+ `parentDocumentId`).
- AI gen ra khỏi lộ trình.
- API cây tài liệu: giữ là việc hoãn duy nhất (ERP đã có `documentId`/`url` của node nó tạo; đọc cây theo quyền user cần grant + thêm nhánh lỗi, ~2 ngày, không thuộc luồng chính).
- SSO yêu cầu user đã được provision qua API; email/tên lấy từ API provision, không lấy từ JWT.

## Câu hỏi chưa giải quyết

1. **Hợp đồng JWT với ERP:** thuật toán (đề xuất ES256), phân phối khóa (JWKS URL hay PEM), claim định danh (`sub` = erpUserId?), `iss`/`aud`, ai dựng link và dựng lúc nào (đề xuất: endpoint ERP ký tại thời điểm click, `exp` ≤ 60s). ERP có giữ được header `Referer` khi chuyển sang bridge không?
2. **Domain / TLS:** ERP, bridge, Outline, permission API có chung registrable domain không? Ảnh hưởng: cookie/SameSite, cách xử lý lệch phiên (đang là hạn chế chấp nhận), ràng buộc chống login CSRF, mẹo giữ màn đồng ý OAuth ở lần đầu. Ai cấp cert, đã có reverse proxy chưa?
3. **`erpUserId` + email:** ERP có đảm bảo `erpUserId` không đổi, không tái sử dụng; email unique, đã xác minh, user không tự sửa tùy ý được không? (Outline khớp account theo email verified.)
4. **Tác giả thật hay service account:** phát hiện ở phase 5: user chưa có phiên Outline thì lần đầu phải mở link 2 lượt (lượt 1 đăng nhập, lượt 2 đồng ý). Chấp nhận, đổi sang service account (−30h), hay phương án headless?
5. **Phiên Outline của user khác trên cùng trình duyệt:** chấp nhận hạn chế + ERP logout đi qua `{outline}/logout`, hay cần ép đăng nhập lại (đặt bridge cùng host Outline, +1 ngày)?
6. **Nơi deploy** (on-prem/cloud); permission API chỉ mở trong mạng nội bộ cho ERP được không?
7. **SMTP:** chạy không email (invite dùng `suppressEmail`, không có thông báo của Outline) có chấp nhận được không?
8. Số user nạp đầu? (`users.invite` giới hạn ~1000 user/giờ.)
9. Quyền mức node: `read` / `read_write` là đủ, hay ERP cần cả `admin` trên doc?
10. Frontmatter `branch` ghi `develop`, nhánh thật đang là `feat/phase-1-new`: lấy nhánh nào?

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

### Session 4 — 2026-10-01
**Trigger:** Phase 01 implemented, tested (PASS), reviewed (7.5/10, 0 critical, fixes applied). Update plan files to match reality.

#### Key Changes (Fallback Applied)
- **MinIO dropped** (Docker Hub/quay.io refuse): Using Outline `FILE_STORAGE=local` + volume `outline-file-storage`, backup tar.gz.
- **PR #13879 still open** (research report was wrong): Pinned Outline `1.10.1` + digest, rule "không move doc" in README.
- **vitest.workspace.ts → vitest.config.ts** (Vitest 5 removed workspace.ts): Using `test.projects` in config.
- **Review fixes applied**: postgres:16 (glibc, not alpine), Outline bind 127.0.0.1, backup umask 077 + COMPLETE marker, REVOKE CONNECT on postgres, format:check + timeout in CI, no-new-privileges + log rotation.
- **Phase 01 marked Done** with review status, success criteria updated to ✓, deviations documented.

### Session 5 — 2026-10-01
**Trigger:** user đổi hướng sản phẩm: không tự viết web UI; ưu tiên SSO.
**Questions asked:** 4 (+ 3 giả định mặc định của planner)

#### Questions & Answers

1. **[Scope]** Phần tự viết còn lại gồm gì?
   - **Answer:** (1) Outline tùy biến bằng config + branding, không fork; (2) permission layer / BFF API headless thay `apps/companion`, không Next.js/React/template/form; (3) quyền đủ mạnh để bên thứ 3 tạo node và user của họ vào Outline sửa; (4) SSO, quan trọng nhất, làm trước.
   - **Rationale:** luồng lõi user tự diễn đạt: giữ API tạo node → trả link → bên thứ 3 theo link → SSO → vào Outline sửa văn bản bình thường. Đây là tiêu chí thành công số 1.

2. **[Architecture]** SSO theo cách nào?
   - **Answer:** token handoff 1 click: ERP ký JWT ngắn hạn mang trong link; bridge verify rồi đăng nhập không mật khẩu. `system_admin` local giữ làm đường admin / break-glass.
   - **Rationale:** bỏ form username/password kiểm qua API ERP → không cần `packages/erp-adapters`.

3. **[Architecture]** Nguồn quyền?
   - **Answer:** bên thứ 3 ĐẨY quyền qua BFF API (cấp/thu user–role trên dự án hoặc trên 1 node); BFF áp ngay vào Outline bằng admin token.
   - **Rationale:** sync worker kéo (phase 9 cũ) và adapter role ERP thật (phase 8 cũ) ra khỏi lộ trình.

4. **[Architecture]** Tác giả doc khi bên thứ 3 tạo node?
   - **Answer:** user THẬT (không phải service account) → BFF cần token Outline theo từng user.
   - **Rationale:** giữ quyết định Session 1. Giá: 1 lần đồng ý trong UI Outline + nhánh `202 pendingUrl` (~30h). Planner ghi rõ để user cân nhắc lại.

#### Giả định mặc định của planner (user có thể lật lại)
- Bỏ template → form → doc; API tạo node nhận `title` + `text` markdown (+ `parentDocumentId`).
- AI gen (phase 5 cũ) ra khỏi lộ trình.
- API cây tài liệu (phase 10 cũ): giữ là việc hoãn duy nhất (phase 7 mới).

#### Quyết định của planner ở chỗ để ngỏ
- Tên app: `apps/outline-permission-api`. Framework: Koa + `@koa/router` (bridge đã buộc dùng Koa).
- Schema `companion` đổi tên thành `permission_api` bằng migration 0002.
- Giữ Playwright với đúng 2 spec (chuỗi SSO, chuỗi đồng ý OAuth).
- Hồ sơ user (email, tên) lấy từ API provision, không lấy từ JWT; SSO yêu cầu user đã provision. Lý do: Outline khớp account theo email verified → email trong JWT là đường chiếm account; tránh PII trên URL.
- Handoff giữ bằng id ngẫu nhiên tham chiếu dòng DB (dùng 1 lần), không phải cookie ký mang account id.
- Lệch phiên Outline: hạn chế chấp nhận (chung registrable domain không giải quyết được vì cookie `accessToken` host-only).
- Login CSRF: `exp` ≤ 60s + `jti` 1 lần + bắt buộc `Referer` từ origin ERP; rủi ro còn lại chấp nhận.

#### Phát hiện khi đối chiếu source Outline `v1.10.1`
- `/oauth/authorize` khi chưa có phiên render thẳng màn Login, không lưu `postLoginPath` → lần đầu của user chưa có phiên cần 2 lượt mở link. Đưa vào câu hỏi mở số 4.
- `users.invite`: 20 invite/request, 50 request/giờ; email đã tồn tại bị lọc ra chứ không lỗi.
- `team.update`, `oauthClients.create`: tên field đã xác nhận trong schema (bảng ở phase 3).
- `documents.create` nhận `id` do client cấp → idempotency chính xác 1 lần.

#### Impact on Phases
- Phase 2: viết lại (SSO handoff, bỏ ERP adapter), đổi tên file. 64h → 68h.
- Phase 3: thành "cấu hình + branding + API client". Quy ước dự án chuyển sang phase 4. 16h → 24h.
- Phase 4: mới, permission API (thay companion + thay phase 9/8 cũ). 56h.
- Phase 5: mới, API tạo node (phần endpoint bên thứ 3 của phase 4 cũ). 44h.
- Phase 6: là phase 7 cũ, bỏ E2E companion, thêm tài liệu tích hợp ERP. 24h.
- Phase 7: là phase 10 cũ, vẫn hoãn.
- Xóa: phase 5 (AI gen), 8 (ERP adapter), 9 (sync worker) cũ.
- Tổng 1-6: 240h (30 ngày), không còn dự phòng.
