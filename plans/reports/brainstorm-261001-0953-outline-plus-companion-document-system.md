# Brainstorm: Hệ thống quản lý document theo dự án — Outline + Companion

Ngày: 2026-10-01 | Trạng thái: đã chốt hướng, chờ plan

## 1. Bài toán & yêu cầu

Hệ thống tài liệu theo dự án, sống suốt vòng đời dự án.

| # | Yêu cầu | Ai đáp ứng |
|---|---|---|
| 1 | Đăng nhập SSO (ERP tự làm auth, chưa có OIDC) | OIDC bridge (tự làm) + Outline OIDC |
| 2 | Page lồng page, markdown, đính kèm PDF/Word | Outline |
| 3 | Mỗi dự án 1 bộ tài liệu, init/update/duy trì | Outline collection + companion init |
| 4 | Editor kiểu Notion/Linear, markdown mạnh | Outline |
| 5 | Role dự án + share page, cha → con kế thừa | Outline (collection permission + document share) |
| 6 | AI gen document | Companion (Claude API) |
| 7 | Dynamic template: chọn mẫu → nhập liệu → sinh doc | Companion |
| 8 | 1 account `system_admin` login không qua SSO | Outline email magic link + local admin ở companion |

Ràng buộc: **1 dev**, không deadline cứng, app riêng (không nhúng ERP), realtime "có thì tốt" (Outline có sẵn).

## 2. Các hướng đã đánh giá

| Hướng | Ưu | Nhược | Kết luận |
|---|---|---|---|
| A. Outline + companion | 5/7 yêu cầu có ngay, chất lượng production; có realtime, search, history, comment miễn phí | Template/AI nằm ngoài editor; phụ thuộc API Outline | **Chọn** |
| B. Build mới từ thư viện (BlockNote, ltree, OIDC) | Toàn quyền UX, template/AI trong editor | 1 dev → 5-6 tháng, thua Outline phần lõi wiki thời gian dài | Loại với 1 dev |
| C. Fork Outline/Docmost | UX liền mạch | Merge upstream đau, codebase lớn, Docmost khóa SSO/permission ở bản EE | Loại |

Lý do chốt A: 1 dev không gánh nổi cái đuôi dài của wiki (search, version, comment, trash, import/export). Dồn công vào 2 phần khác biệt: template + AI.

## 3. Đã kiểm chứng về Outline (2026-10)

- **Kế thừa quyền:** share 1 document cho user/group → mọi document con nhận cùng quyền. Collection permission phủ toàn bộ doc trong collection. Đúng yêu cầu #5.
- **License BSL 1.1:** dùng nội bộ tự host được phép. Chỉ cấm bán "Document Service" cho bên thứ ba.
- **Email magic link:** chạy được không cần SSO. Cần SMTP + `guestSignin = true` trên team + không để biến SSO rỗng trong `.env`.
- **MCP endpoint `/mcp`:** có sẵn, AI agent đọc/ghi doc trực tiếp.
- **API tạo doc từ bên thứ 3:** `documents.create` (collectionId, parentDocumentId, title, text, templateId, publish) → trả document object → mở link trong Outline để nhập liệu. Field `url`/`urlId` trong response: xác nhận ở spike.
- **API thay mặt user:** có OAuth 2.0 app + scope (`documents:read`...) → companion không cần token admin.
- **Quyền là mô hình push, không pull:** Outline không gọi API ngoài để hỏi quyền. Bên ngoài đẩy vào qua `collections.add_user/add_group`, `documents.add_user/add_group`, `groups.add_user`, `users.suspend` (mức `read` / `read_write` / `admin`). Outline tự ẩn node user không có quyền.
- **Group sync qua OIDC claim `groups`** khi đăng nhập: có PR #13857, chưa xác nhận đã vào bản release → kiểm tra ở spike. SCIM native chỉ có ở bản trả phí.
- **Webhook:** có (`webhookSubscriptions`), dùng để companion nghe sự kiện doc.
- **Bug đã biết:** move document làm rơi quyền kế thừa của doc con (PR #13879) → phải dùng bản đã có fix.
- **Giới hạn:** không khóa riêng được doc con (quyền kế thừa tự tạo lại). Không ảnh hưởng vì không cần override.

## 4. Giải pháp chốt

### 4.1 Mapping khái niệm
- Dự án = 1 Outline **collection**. Role dự án = collection permission (view / edit / manage), gán theo **group**.
- Share page = Outline document share (user hoặc group, read/edit), kế thừa xuống con.
- Bộ template = 1 collection `Templates` trong Outline; thân template là document thường chứa `{{placeholder}}`.

### 4.2 Thành phần
```
ERP login ──> OIDC bridge ──> Outline (docs, quyền, editor, file, realtime)
                    └──────> Companion (template form, AI gen, init dự án) ──API──> Outline
system_admin ── magic link ──> Outline
system_admin ── local login ─> Companion
```

1. **Outline self-host**: Docker, Postgres, Redis, MinIO (file đính kèm). Pin version.
2. **OIDC bridge**: provider OIDC mỏng, ủy quyền đăng nhập cho ERP auth hiện có, phát id_token (sub, email, name, groups). Dùng thư viện OIDC đã certified, không tự viết crypto. Dùng chung cho Outline và companion.
3. **Companion** (app web nhỏ):
   - Chọn template → tự dò `{{ten_bien:kieu}}` → render form → merge → `documents.create` vào đúng collection/parent.
   - AI gen: template + input + (tùy chọn) doc ngữ cảnh → Claude API, streaming preview → user duyệt → tạo doc.
   - Init dự án: tạo collection + group + cây doc khởi tạo từ "bộ mẫu dự án".
   - Không có editor riêng (DRY): template soạn ngay trong Outline.

### 4.3 system_admin không qua SSO
- **Outline:** bật email sign-in, account admin đăng nhập bằng magic link. Độc lập với ERP và bridge → dùng làm break-glass khi SSO hỏng.
- **Companion:** 1 account local, password hash (argon2) trong env, rate-limit + audit log.
- Lưu ý: magic link là email, không phải password. Nếu bắt buộc username/password cho Outline → thêm 1 local account trong OIDC bridge (nhưng phụ thuộc bridge còn sống).
- Bảo mật: giới hạn email sign-in chỉ cho account đã tồn tại; không mở cho mọi email.

## 5. Rủi ro & cần spike (tuần 0)

| Rủi ro | Mức | Xử lý |
|---|---|---|
| Companion gọi API bằng token admin → vượt quyền user | Cao | Gọi API **thay mặt user** (OAuth app của Outline hoặc API key theo user). Chưa kiểm chứng → spike đầu tiên |
| OIDC bridge phụ thuộc cơ chế auth ERP (session/JWT, stack) | Cao | Spike; nếu khó → Keycloak/Authentik + đồng bộ user |
| UX template/AI ngoài editor bị người dùng chê | TB | Link companion ghim trong Outline; deep-link kèm collection/parent hiện tại |
| Outline đổi API khi nâng cấp | TB | Pin version, gom mọi call qua 1 client module, test hợp đồng |
| User nghỉ việc vẫn còn quyền | TB | Job đồng bộ suspend user từ ERP |
| Nội dung tài liệu gửi ra Claude API | TB | Xác nhận chính sách dữ liệu nội bộ trước khi bật |
| Email sign-in mở rộng hơn ý muốn | Thấp | Kiểm tra khi spike: chỉ account đã tồn tại mới nhận link |

## 6. Lộ trình (1 dev, ~6-7 tuần)

| Giai đoạn | Thời gian | Kết quả |
|---|---|---|
| 0. Spike | 1 tuần | Outline chạy docker; PoC OIDC bridge; magic link admin; gọi API thay mặt user |
| 1. Nền tảng | 2 tuần | OIDC bridge production, deploy Outline, quy ước dự án = collection, group/role |
| 2. Template | 2 tuần | Companion: chọn mẫu, form, merge, tạo doc; init bộ tài liệu dự án |
| 3. AI | 1-2 tuần | Gen draft từ template + input, streaming preview, tạo doc |

## 7. Tiêu chí thành công

- User ERP đăng nhập Outline bằng 1 click, không tạo account riêng.
- Share page cha → người nhận thấy toàn bộ page con, không thấy page ngoài nhánh.
- Tạo doc chuẩn từ template < 2 phút, style đồng nhất.
- `system_admin` đăng nhập được khi ERP/bridge tắt.
- Companion không trả về nội dung doc mà user không có quyền đọc.

## 8. Điều kiện xem lại quyết định (chuyển sang build mới)

- Người dùng không chấp nhận template/AI nằm ngoài editor sau 1-2 tháng dùng thật.
- Cần quyền mà Outline không làm được (khóa riêng doc con, quyền theo field).
- Cần gắn chặt entity ERP vào từng doc.

## 9. Câu hỏi chưa giải quyết

1. Stack và cơ chế auth của ERP (session cookie hay JWT, ngôn ngữ) → quyết định cách làm OIDC bridge.
2. Group/role lấy từ ERP hay quản lý tay trong Outline?
3. Có SMTP nội bộ cho magic link chưa?
4. `system_admin` chấp nhận magic link hay bắt buộc username/password?
5. Chính sách cho phép gửi nội dung tài liệu ra Claude API? Ngân sách token?
6. Hạ tầng deploy (on-prem / cloud), backup Postgres + MinIO.

## Nguồn

- https://www.getoutline.com/changelog/document-permissions
- https://www.getoutline.com/changelog/group-document-membership
- https://github.com/outline/outline/pull/13879
- https://github.com/outline/outline/blob/main/LICENSE
- https://github.com/outline/outline/discussions/8024
- https://www.getoutline.com/developers
