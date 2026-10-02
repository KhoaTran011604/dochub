# Phase 03: Cấu hình + branding Outline, Outline API client

## Context Links

- [plan.md](./plan.md) · [phase 02](./phase-02-oidc-bridge-sso-token-handoff-and-local-system-admin.md)
- [research 04](./research/researcher-04-outline-permission-api-user-provisioning-and-branding.md) (phần lớn ghi ASSUMED; lệch với mục Key Insights thì Key Insights đúng)
- Source Outline `v1.10.1`: `server/routes/api/teams/schema.ts`, `server/routes/api/oauthClients/schema.ts`, `.env.sample`

## Overview

- Ngày: 2026-10-01
- Mô tả: tùy biến Outline chỉ bằng env + team settings (image chính thức pin `1.10.1` + digest, không fork). Viết `outline-api-client` dùng chung và 2 script idempotent: áp team settings, đăng ký OAuth client cho phase 5.
- Priority: P1
- Implementation status: Hoàn thành. Code đã verify sống trên Outline thật + qua `code-reviewer` (1 fix bảo mật, 1 fix correctness, đã áp dụng).
- Review status: Đã review (`code-reviewer`) — 2 finding áp dụng, 7 finding thấp bỏ qua (YAGNI, không chặn merge)
- Effort: 24h (3 ngày)

## Key Insights

- `team.update` nhận các field sau (đã đọc schema ở tag `v1.10.1`): `name`, `avatarUrl`, `sharing`, `guestSignin`, `passkeysEnabled`, `memberCollectionCreate`, `memberTeamCreate`, `defaultUserRole`, `inviteRequired`, `allowedDomains`, `preferences.{publicBranding, membersCanInvite, membersCanCreateApiKey, membersCanDeleteAccount, viewersCanExport, customTheme{accent, accentText}, mcp, emailDisplay, commenting}`.
- `inviteRequired: true` → `userProvisioner` từ chối user chưa được invite. Khớp với quy tắc "provision trước, SSO sau" của phase 2/4: lớp chặn thứ hai ngay trong Outline.
- `oauthClients.create` nhận `name`, `redirectUris[]` (1-10), `clientType` (mặc định `confidential`), `published`, `description`, `developerName`, `developerUrl`, `avatarUrl`.
- Outline có đăng ký client động `/oauth/register` (code đọc `env.OAUTH_DISABLE_DCR`) → nên tắt.
- `DEFAULT_LANGUAGE` có trong `.env.sample`.
- Không fork thì không gỡ hết được chữ "Outline" trong UI. Branding = tên, logo, màu nhấn, ngôn ngữ, tên nút đăng nhập.
- Admin token của hệ thống = API key do `system_admin` tạo trong Settings → API (không có endpoint tạo key cho người khác). Khác với key break-glass cất offline.

## Giả định + fallback (thử ngay ngày 1, bước 2)

| Giả định | Kết quả thực tế (2026-10-02, Outline `1.10.1` sống trong docker-compose) |
|---|---|
| API key admin gọi được `team.update` | **Đúng.** Chạy `apply-workspace-settings` thật: áp 11 field đổi (`name`, `sharing`, `passkeysEnabled`, `memberCollectionCreate`, `memberTeamCreate`, `inviteRequired`, `preferences.*`) thành công. Chạy lại lần 2 → "already match desired state", không gọi `team.update`. |
| API key admin gọi được `oauthClients.create` | **Đúng.** `register-oauth-client` đã tạo client `hd-document-permission-api` từ trước (id/secret đã nằm trong `infra/.env`). Chạy lại lần 2 → "already registered", không gọi update. |
| `DEFAULT_LANGUAGE=vi_VN` là mã hợp lệ | Chưa thử `vi_VN` thật; `infra/.env` đang để `en_US` (an toàn, theo đúng fallback đã định). Không chặn merge phase này. |
| `avatarUrl` nhận URL ngoài | Chưa thử (`WORKSPACE_LOGO_URL` để trống trong `.env` hiện tại — giữ logo mặc định). Không chặn merge phase này; thử khi có URL logo thật. |

## Requirements

Chức năng:
- Env Outline: chỉ OIDC (không bật provider khác, không SMTP → không magic link), không đặt `OIDC_DISABLE_REDIRECT`, `OIDC_DISPLAY_NAME`, `OIDC_USERNAME_CLAIM=preferred_username`, `OIDC_SCOPES=openid profile email`, `DEFAULT_LANGUAGE`, `OAUTH_DISABLE_DCR=true` (kiểm tên biến khi làm).
- `packages/outline-api-client`: nơi duy nhất gọi Outline API; nhận token từ caller.
- Script `apply-outline-workspace-settings`: đọc cấu hình mong muốn → `team.update`. Chạy lại không đổi gì.
- Script `register-outline-oauth-client`: `oauthClients.list` tìm theo tên → thiếu thì tạo, in `clientId` + `clientSecret` 1 lần để điền env.

Phi chức năng:
- Client: `fetch` có sẵn, timeout, retry có giới hạn cho 429 (theo `Retry-After`) và 5xx, lỗi có kiểu. Không thêm thư viện HTTP.
- Chỉ viết endpoint thật sự dùng.
- File < 200 dòng.

## Architecture

```
packages/outline-api-client     outline-http-client → POST {OUTLINE_URL}/api/{method}, Bearer <token>
packages/outline-workspace-setup
  ├ apply-outline-workspace-settings-cli ──admin token──> team.update
  └ register-outline-oauth-client-cli   ──admin token──> oauthClients.list | create
```

Team settings mong muốn:

| Mục đích | Field | Giá trị | Trạng thái field |
|---|---|---|---|
| Tên workspace | `name` | từ env | đã xác nhận |
| Logo | `avatarUrl` | URL từ env | đã xác nhận field; URL ngoài: kiểm khi làm |
| Logo ở trang đăng nhập | `preferences.publicBranding` | `true` | đã xác nhận |
| Màu nhấn | `preferences.customTheme.accent`, `.accentText` | từ env | đã xác nhận |
| Bật public sharing (toggle "Publish to web" + "Include nested documents" theo từng tài liệu; tắt = Outline ẩn toggle ở mọi collection) | `sharing` | `true` (đổi 2026-10-02, trước là `false`) | đã xác nhận |
| Tắt đăng nhập email | `guestSignin` | `false` | đã xác nhận |
| Tắt passkey | `passkeysEnabled` | `false` | đã xác nhận |
| Chỉ user đã provision mới vào được | `inviteRequired` | `true` | đã xác nhận |
| Member không mời người | `preferences.membersCanInvite` | `false` | đã xác nhận |
| Member không tạo collection | `memberCollectionCreate` | `false` | đã xác nhận |
| Member không tạo workspace | `memberTeamCreate` | `false` | đã xác nhận |
| Member không tạo API key | `preferences.membersCanCreateApiKey` | `false` | đã xác nhận |
| Member không tự xóa account | `preferences.membersCanDeleteAccount` | `false` | đã xác nhận |
| Tắt MCP ngoài | `preferences.mcp` | `false` | đã xác nhận |
| Role mặc định | `defaultUserRole` | `member` | đã xác nhận field; `viewer` có sửa được doc khi có quyền `read_write` không: kiểm khi làm |

"Đã xác nhận" = có trong schema ở tag `v1.10.1`; hiệu lực thực tế vẫn kiểm bằng mắt ở bước 6.

## Related Code Files

Tạo `packages/outline-api-client/`:
- `src/index.ts`
- `src/outline-http-client.ts`
- `src/outline-api-errors.ts`
- `src/outline-api-types.ts`
- `src/team-api.ts`
- `src/oauth-clients-api.ts`

Tạo `packages/outline-workspace-setup/`:
- `src/desired-workspace-settings.ts` (zod: env → object settings)
- `src/apply-outline-workspace-settings-cli.ts`
- `src/register-outline-oauth-client-cli.ts`

Sửa: `infra/docker-compose.yml` (env Outline), `infra/.env.example` (`DEFAULT_LANGUAGE`, `OAUTH_DISABLE_DCR`, `OUTLINE_ADMIN_API_TOKEN`, `WORKSPACE_NAME`, `WORKSPACE_LOGO_URL`, `WORKSPACE_ACCENT_COLOR`, `OUTLINE_OAUTH_CLIENT_ID/SECRET`), `infra/README.md`.

## Implementation Steps

1. `outline-http-client.ts`: parse `{ ok, data }`, map 400/401/403/404/429/5xx thành class lỗi, timeout, retry.
2. **Ngày 1:** `system_admin` tạo API key → gọi thử `team.update` (đổi `name`) và `oauthClients.create` bằng key đó. Sai → áp fallback, ghi kết quả vào file này.
3. `team-api.ts`, `oauth-clients-api.ts`.
4. `desired-workspace-settings.ts` + CLI áp settings. In diff trước/sau; không có thay đổi → thoát 0, không gọi update.
5. CLI đăng ký OAuth client: tên cố định `hd-document-permission-api`, `redirectUris = [{PERMISSION_API_PUBLIC_URL}/oauth/outline/callback]`, `published: true` (kiểm ý nghĩa field khi làm). Đã có client cùng tên nhưng lệch redirect → `oauthClients.update`.
6. Env Outline + restart; kiểm bằng mắt: ngôn ngữ, tên, logo, màu, không còn nút đăng nhập email/passkey, member không thấy nút mời/tạo collection, link share công khai bị tắt.
7. Ghi vào `infra/README.md`: thứ tự cài mới (login `system_admin` → tạo API key → chạy 2 script).
8. Test: unit cho http client (retry, map lỗi) + parse settings; tích hợp với Outline thật: chạy mỗi script 2 lần → lần 2 không đổi gì.

## Todo List

- [x] `outline-api-client`: http client + lỗi có kiểu
- [x] Ngày 1: thử `team.update` + `oauthClients.create` bằng API key admin, ghi kết quả
- [x] `team-api`, `oauth-clients-api`
- [x] Script áp team settings (idempotent) — verify sống: 11 field áp đúng, chạy lại không đổi gì
- [x] Script đăng ký OAuth client (idempotent) — verify sống: client đã tồn tại, chạy lại không đổi gì
- [x] Env Outline: ngôn ngữ, chỉ OIDC, tắt DCR
- [ ] Kiểm bằng mắt từng setting (UI Outline — cần người xác nhận trực quan: nút đăng nhập, share công khai, nút mời/tạo collection)
- [x] README: thứ tự cài mới
- [x] Unit test (22 test, `outline-api-client` + `outline-workspace-setup`, pass) — integration xác nhận bằng cách chạy CLI thật 2 lần ở trên

## Success Criteria

- Outline mới cài + 2 script → đúng tên, logo, màu, ngôn ngữ; chỉ còn đường đăng nhập qua bridge.
- User chưa provision không tự vào được workspace.
- Member không mời người, không tạo collection, không bật share công khai, không tạo API key.
- Chạy lại script: không thay đổi, không lỗi.
- Có `clientId`/`clientSecret` OAuth cho phase 5.

## Risk Assessment

- Field có trong schema nhưng không có hiệu lực như mong đợi → bước 6 kiểm bằng mắt từng mục.
- `inviteRequired` bật trước khi có API provision (phase 4) → user dev seed ở phase 2 mà chưa login lần nào sẽ bị chặn (user đã login không ảnh hưởng). Cho user dev login 1 lần trước khi chạy script, hoặc provision lại qua API phase 4.
- Nâng cấp Outline đổi tên field → script báo lỗi validate rõ, không nuốt lỗi.

## Security Considerations

- Admin token: chỉ qua env, không log, không in ra khi script lỗi.
- `clientSecret` OAuth in đúng 1 lần ra stdout, không ghi file.
- Tắt mọi đường đăng nhập ngoài OIDC; tắt đăng ký client động.
- `membersCanCreateApiKey: false` → user ERP không tự phát hành token dài hạn.

## Code Review (2026-10-02, `code-reviewer`)

Đã áp dụng:
- **[Cao]** `oauthClients.create` không idempotent nhưng bị retry chung với mọi lỗi mơ hồ (timeout/5xx/network) → rủi ro tạo trùng client, `clientSecret` mồ côi không ai biết. Fix: thêm `OutlineRequestOptions.retry` (mặc định `true`), `createOAuthClient` gọi với `retry: false`.
- **[Trung]** `compute-team-settings-diff.ts` diff `customTheme.accent`/`accentText` độc lập → patch có thể chỉ gửi 1 field, nếu Outline không deep-merge `customTheme` sẽ xóa mất field còn lại. Fix: khi 1 trong 2 đổi, patch gửi cả 2 field cùng lúc.
- Đã verify lại sống trên Outline thật sau fix: 2 script vẫn chạy đúng, idempotent.

Bỏ qua (thấp, không chặn merge, YAGNI):
- `maxRetries` là tổng số lần gọi chứ không phải số lần retry (đã sửa comment cho đúng nghĩa).
- `Retry-After: 0` fallback về backoff thay vì retry ngay (đã sửa tiện tay khi fix bug retry — giờ dùng `!== undefined`).
- `WORKSPACE_LOGO_URL` dùng `z.url()` trần thay vì giới hạn `http(s)` như các URL khác — rủi ro thấp vì admin tự điền.
- `listOAuthClients` không phân trang (`limit: 100`) — chưa cần ở quy mô workspace hiện tại.
- JSON lỗi/thiếu trên response 2xx bị nuốt thành `data: undefined` thay vì báo lỗi rõ.
- `created.clientSecret` không assert trước khi in — rủi ro thấp vì `clientType` luôn `confidential`.

## Next Steps

- Phase 4 thêm module users/groups/collections/documents vào client.
- Phase 5 dùng OAuth client đã đăng ký.
- Kiểm bằng mắt UI Outline (xem Todo List) — cần người xác nhận, chưa làm trong phase này.
