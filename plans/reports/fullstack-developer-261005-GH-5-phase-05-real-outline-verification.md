# Phase 05: kiểm thật với Outline v1.10.1 (2026-10-05)

Chạy trên stack compose đang bật. Mọi số liệu dưới đây là đo thật, không suy từ source.

## Kết luận ngắn

Giả định 1 (OAuth self-host chạy) và 2 (refresh dùng offline) **đúng**. Không cần phương án B/C.
Phát hiện 2 lỗi cấu hình (không phải lỗi code Outline) và 1 bug production (502 khi cùng key chạy song song / replay sau sập).

## Đã đo

| Mục | Kết quả |
|---|---|
| authorize → consent → code → token | OK. Màn đồng ý: nút "Authorize" / "Cancel". `POST /oauth/token` trả `expires_in: 3600`, `token_type: Bearer` |
| `documents.create` bằng token user | OK; `createdBy` = đúng user (so id với `auth.info`) |
| `auth.info` bằng token user | OK |
| Scope `documents:create auth:read` | **Chấp nhận**, hiện "Create documents / Read auth", token trả scope y nguyên. Không cần fallback `create read` (cũng chạy) |
| Scope `documents:create auth:read_write` (giá trị đang nằm trong infra/.env) | **Sai**: nút Authorize không làm gì, kẹt ở `/oauth/authorize`. `read_write` không phải scope hợp lệ cho `auth` |
| Refresh | 2 lần liên tiếp OK, mỗi lần xoay refresh token mới + `expires_in: 3600`, scope giữ nguyên. Dùng lại refresh token cũ: `400 invalid_request "refresh token is invalid"` (không có grace) |
| Hạn refresh token | **30 ngày**, tính từ lúc phát (bảng `oauth_authentications.refreshTokenExpiresAt`); mỗi lần refresh phát token mới nên **trượt**: user có tạo doc ít nhất 1 lần/30 ngày thì không phải đồng ý lại. Rảnh > 30 ngày → `invalid_grant` → 202 |
| `/oauth/revoke` | 200 |
| Chưa có phiên Outline | **Giả định "mất màn đồng ý" SAI** (với bridge đã có phiên/handoff): mở `pendingUrl` → Outline hiện màn Login (2 nút: "Continue with HD ERP", "Continue with Email") → bấm SSO → **quay lại đúng `/oauth/authorize` và hiện màn đồng ý** → Authorize → vào doc. Không cần "mở lại link". Bỏ ghi chú đó khỏi docs/erp-integration-api-guide.md mục 3.4(7) + mục 8. Chưa thử với IdP thật chưa có phiên (không có credential): bước đó là 1 màn IdP thêm |
| Sau đồng ý | Key mới → 201 ngay |

## Lỗi cấu hình đã tìm ra

1. **`OUTLINE_OAUTH_CLIENT_ID` sai loại id (nghiêm trọng).** Outline có 2 id: `id` (UUID) và `clientId` (chuỗi public, vd `3zaxp...`). `/oauth/authorize` và `/oauth/token` cần `clientId`; UUID cho "OAuth client could not be found" (`oauthClients.info` 404). `register-outline-oauth-client-cli.ts` in `created.id` và tài liệu bảo user dán vào env -> sai. Fix đề xuất: CLI in `OUTLINE_OAUTH_CLIENT_ID=${created.clientId}` (cả nhánh "already registered"/"updated" dùng `existing.clientId`/`updated.clientId`); kiểm `OutlineOAuthClient` type có field `clientId`; sửa chú thích infra/.env.example. Mình đã đặt giá trị đúng vào infra/.env cục bộ. Secret trong env khớp secret của client (đã kiểm).
2. **Scope trong infra/.env**: `OUTLINE_OAUTH_SCOPE="documents:create auth:read_write"` → đã đổi thành `"documents:create auth:read"`. Nên validate scope trong `environment-config.ts` hoặc bỏ biến (mặc định đúng).
3. `PERMISSION_API_PUBLIC_URL`: file infra/.env đã ghi 4100 (ai đó sửa trước) nhưng container còn chạy với 4002 và OAuth client đăng ký redirect 4002. Đã chạy `register-oauth-client` (cập nhật redirect URI sang `http://localhost:4100/oauth/outline/callback`) + recreate container (`--no-build --force-recreate`). Giá trị đúng cho dev: `http://localhost:4100`.

## Thay đổi môi trường cục bộ (đều gitignored, đã báo)

- infra/.env: `OUTLINE_OAUTH_CLIENT_ID` -> clientId; `OUTLINE_OAUTH_SCOPE` -> `documents:create auth:read`; `ERP_SSO_PUBLIC_KEY_PEM` điền public key suy từ `apps/oidc-bridge/.dev-keys` (trước đó trống, `/sso` trả `erp_key_unavailable`, JWKS erp-fake :4000 không chạy). Cần để E2E đăng nhập user ERP bằng link SSO dev. Backup infra/.env trước khi sửa: `%TEMP%\claude\infra.env.bak`.
- OAuth client: redirect URI = 4100 (qua CLI). Đã từng thêm tạm `http://localhost:4999/cb` để đo token thô, **đã gỡ**.
- Container `outline-permission-api` + `oidc-bridge` recreate (không rebuild: image cũ, trước các sửa src đang làm song song).
- Service client `e2e-test` (scope users:write, permissions:write, documents:create, project `*`); key ghi vào `tests/e2e/.env` (`E2E_PERMISSION_API_SERVICE_KEY`, gitignored). Lưu ý: 1 lần mình lỡ in 1 phần key ra log terminal; key dev cục bộ, nên `rotate e2e-test` nếu lo.

## Bug production (không sửa vì src đang có agent khác chỉnh)

**Cùng `Idempotency-Key` gửi song song -> 1 request 201, request kia 502.** Doc vẫn chỉ 1 (an toàn), nhưng sai hợp đồng "gọi lại cùng key không lỗi". Cùng gốc: **sập giữa lúc Outline đã tạo doc và trước `idempotency.complete`** -> mọi replay cùng key gọi lại `documents.create` với cùng `id` và nhận lỗi Outline -> 502 vĩnh viễn (ERP kẹt, phải dùng key mới -> có thể tạo doc trùng).
- Vị trí: `apps/outline-permission-api/src/documents/create-document-as-user-service.ts` hàm `process()` (khối `try { createDocumentWithUserToken ... } catch`, ~dòng 112-125) + `create-outline-document-with-user-token.ts`.
- Đề xuất (đúng dòng "Giả định" #5 của plan): khi `documents.create` lỗi không phải 401, tra `documents.info` theo `documentId` đã lưu bằng token user; nếu tồn tại (và thuộc `collectionId`) -> coi là đã tạo, `complete(201)` và trả `{documentId, url}`; nếu không tồn tại -> ném lỗi cũ. Hoặc, riêng race song song: trả 409 `REQUEST_IN_PROGRESS` + `Retry-After` khi dòng idempotency chưa có `response_status` và đang xử lý.
- Test E2E đang chỉ in ra status song song (`concurrent same-key statuses: 502,201`) và khẳng định "đúng 1 doc + replay sau đó 201". Sau khi sửa, đổi thành khẳng định không có 5xx.

## Test đã viết (tests/e2e, gate theo `E2E_PERMISSION_API_SERVICE_KEY`, thiếu thì skip)

- `create-node-pending-consent-flow.spec.ts` (3 test): 202 -> mở pendingUrl -> Authorize -> đứng ở doc, replay 202 giữa chừng cùng requestId, replay sau xong -> 201 cùng documentId, tác giả đúng; key thứ 2 -> 201 ngay; cùng key khác body -> 409.
- `create-node-real-outline-integration.spec.ts` (5 test): tác giả = user thật; cùng key 1 doc; viewer -> 403 `ACTING_USER_FORBIDDEN` và không tạo gì; người khác hoàn tất pendingUrl -> 403 + không lưu grant (key mới của victim vẫn 202); hết hạn -> 410 ở route trình duyệt và ở replay; user tự thu hồi app trong Outline (`oauthAuthentications.delete`) -> 202 lại -> đồng ý lại -> 201; validate (thiếu key 400, user lạ 404, project lạ 404).
- Helper: `permission-api-fixture.ts`, `consent-flow-helpers.ts`, `bridge-dev-scripts.ts`; `e2e-environment.ts` (+`createNodeEnvironment`); `.env.example`.
- `apps/outline-permission-api/integration/expire-pending-request-cli.ts`: script owner-DB ép request hết hạn (TTL thật 7 ngày). Thêm `integration` vào `tsconfig.json` của package để typecheck.
- Lệch so với giao việc: test tích hợp "với Outline thật" đặt ở Playwright (tests/e2e), không phải vitest, vì bước đồng ý bắt buộc có trình duyệt và phiên Outline; vitest không có browser. Không tạo spec vitest rỗng (YAGNI).

Kết quả chạy: `npx playwright test create-node` = 8/8 pass (~47s). `pnpm --filter @hd-document/e2e typecheck`, `... outline-permission-api typecheck` và eslint trên file mới: sạch.
Dữ liệu test: doc tạo ra đều xóa (mềm + vĩnh viễn) trong `afterAll`; collection probe `E2E e2e-consent` đã xóa. Còn lại cố ý: collection `E2E e2e-create-node`, 6 user `e2e-create-node-*@hd-document.test` + 1 `e2e-consent-a@...` (UUID cố định, dùng lại), dòng `pending_document_requests`/`idempotency_keys` (không có quyền DELETE cho app role; migration 0005 đang thêm dọn dẹp).

## Việc khác phát hiện

- `sso-handoff-link-opens-document-as-erp-user.spec.ts` (có từ trước) **đang fail** ở `beforeAll`: Outline giờ hiện màn Login 2 nút thay vì tự chuyển sang form bridge (`#username` không có). Cần cập nhật fixture đăng nhập admin (`outline-admin-fixture.ts`): bấm "Continue with HD ERP" rồi vào `/interaction/<uid>/admin`. Không sửa vì ngoài phạm vi.
- `runBridgeDevScript` trùng lặp giữa sso spec và `bridge-dev-scripts.ts` mới; gộp khi sửa sso spec.
- `playwright.config.ts` đã bị sửa tạm rồi hoàn lại (không còn diff).

## Câu hỏi chưa rõ

- IdP thật chưa có phiên (user chưa login ERP): flow chạy tiếp nhưng thêm màn IdP; chưa kiểm vì không có credential IdP.
- Người sửa `register-outline-oauth-client-cli.ts` (clientId) là ai: package đó ngoài ownership của mình.
