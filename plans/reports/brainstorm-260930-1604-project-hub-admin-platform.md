# Brainstorm Summary: Project Document Hub & Client Publish Platform

**Date:** 2026-09-30 | **Status:** Consensus reached, ready for `/plan`

## Problem Statement
Cty cần admin platform quản lý tài liệu của tất cả dự án (10-50 projects, 20-100 nội bộ users), mỗi project có không gian riêng để tổng hợp/xâu chuỗi tài liệu, dễ publish thành site chia sẻ cho khách hàng (kiểu Notion public page). Yêu cầu:
- SSO (deferred — design pluggable, implement sau)
- Permission phân cấp kiểu Notion: share ở node gốc → con kế thừa quyền, override được ở bất kỳ level nào
- Dynamic template cho nhập liệu (mỗi loại project có schema field khác nhau)
- AI gen document từ template+data, tóm tắt nhiều doc thành 1 bản tổng quan
- Publish site: public link không cần login, branding (logo/theme color) riêng theo project/khách hàng

Greenfield build. Stack alignment mong muốn: Node.js/TS (NestJS) + PostgreSQL, self-hosted, theo convention monorepo `apps/web` + `apps/api` đã có trong dev-rules của cty (GenericForm/GenericTable, centralized query keys).

## Evaluated Approaches

### A. Fork Docmost (AGPL, NestJS+Postgres, perms+public share có sẵn)
- Pros: stack khớp 100%, editor+permission+share đã có, active maintenance
- Cons: data model là "page/block" (wiki), KHÔNG có concept "Project" hay "structured dynamic template" — nhồi thêm = vật lộn với internals người khác. AGPL fork phải maintain drift mãi mãi. Custom branding per share KHÔNG có sẵn.

### B. Fork Wiki.js (AGPL, Node+Postgres, plugin system mạnh, SSO free)
- Pros: plugin architecture linh hoạt nhất, SAML/OIDC free tier
- Cons: vẫn thiếu Project entity + dynamic template + AI, vẫn phải tự viết phần lớn logic nghiệp vụ qua plugin — effort gần như build từ đầu nhưng gò trong kiến trúc plugin của người khác.

### C. Custom build, mượn Tiptap/BlockNote editor library — **CHỌN**
- Pros: toàn quyền thiết kế Project-as-root-entity, permission engine riêng, dynamic template (JSON Schema+JSONB), AI pipeline, publish branding. Không AGPL fork-drift. Phần khó nhất (block editor UX) vẫn có sẵn qua Tiptap/BlockNote (chính thư viện Docmost dùng bên trong). Khớp convention monorepo có sẵn của cty.
- Cons: phải tự build permission engine + publish renderer từ đầu (nhưng đây vốn là core-value của hệ thống, không phải thứ nên outsource cho 1 platform ngoài).
- Risk: phải tự làm collaborative editing/versioning nếu cần sau này (Tiptap hỗ trợ qua Yjs, chưa scope MVP).

## Final Recommendation
**Custom build (Option C).** Lý do quyết định: phần khác biệt cốt lõi (Project entity + dynamic template + AI + client-branded publish) không được OSS platform nào cover — fork chỉ tiết kiệm được phần "wiki editor UI", và phần đó lấy được miễn phí qua thư viện Tiptap/BlockNote mà không cần fork nguyên app.

### Architecture Sketch
- **Data model:** `Project` (root) → `Space/Folder` (nested, unlimited depth) → `Document` (2 loại: `page` rich-text via Tiptap/BlockNote JSON, hoặc `form` structured data theo dynamic template)
- **Permission engine:** ACL node-based, mỗi node (`Project`/`Folder`/`Document`) có role assignments (viewer/editor/admin), resolve quyền = walk up tree tìm ACL entry gần nhất (giống Docmost/BookStack pattern) — override ở bất kỳ level nào chặn/mở rộng quyền kế thừa
- **Dynamic template:** `templates` table (`id`, `project_type`, `schema: JSONB`, `ui_schema: JSONB`) → frontend render qua react-jsonschema-form, backend validate qua `ajv`
- **AI service layer:** interface riêng (không lock-in), implement đầu tiên qua Claude proxy nội bộ đã có. 2 use case: (1) gen doc content từ template+project data, (2) summarize N docs trong 1 project → bản tổng quan. MVP: concat content trong token budget, chưa cần vector DB/RAG (YAGNI — chỉ thêm khi corpus/project quá lớn)
- **Publish:** route public riêng (`/public/:shareToken`) render read-only tree, theme override (logo+primary color) lưu ở cấp `Project`. Custom domain/DNS — deferred (không trong MVP)
- **Auth:** email/password trước, thiết kế abstraction để cắm SSO (OIDC/SAML) sau mà không đổi schema user
- **Frontend:** theo convention cty — `apps/web` React, TanStack Query với `queries/{domain}/{queries,mutations}.ts`, centralized `queries/keys.ts`, dùng GenericForm/GenericTable. Mobile app — chưa cần, bỏ qua (YAGNI) trừ khi có yêu cầu riêng.
- **Backend:** `apps/api` **Fastify thuần (không NestJS)** + PostgreSQL (JSONB cho template/content) + Redis cho queue AI job async. Tận dụng Fastify native JSON Schema validation ở route-level — dùng chung schema với dynamic-template (`ajv`), tránh duplicate validation logic. Team tự thống nhất convention module/plugin structure (không có DI sẵn như Nest) — cần chốt convention này ngay đầu implementation phase.

## Implementation Considerations & Risks
- Permission engine là phần rủi ro nhất về edge case (share subtree, revoke, multiple role paths) — cần test kỹ, tham khảo model Docmost/BookStack làm reference (không copy code, chỉ học design)
- AI proxy nội bộ: cần xác nhận rate limit/cost trước khi build summarize-nhiều-doc (context lớn = cost cao)
- Timeline 1-3 tháng với vài dev: MVP nên giới hạn — KHÔNG làm real-time collaborative editing, KHÔNG custom domain, KHÔNG RAG/vector search ở giai đoạn 1

## Success Metrics
- Tạo project → thêm document (page/form) → set permission subtree → publish public link có branding: full flow chạy được end-to-end
- Dynamic template: đổi schema không cần deploy code (chỉ update JSONB + ui_schema)
- AI gen: tạo được 1 document draft từ template data trong <30s

## Next Steps
- Chạy `/plan` để lên implementation plan chi tiết theo phases (data model → permission engine → editor → dynamic template → AI → publish)
- Cần xác nhận thêm: tên/endpoint của Claude proxy nội bộ trước khi vào implementation phase AI

## Unresolved Questions
- SSO provider cụ thể (Google Workspace/Entra ID/khác) — user nói để sau, cần quyết định trước khi build auth abstraction layer chi tiết
- Custom domain per project — có cần ở phase 2 không, hay mãi mãi chỉ cần theme/logo?
