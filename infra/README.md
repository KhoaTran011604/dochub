# infra — chạy Outline + oidc-bridge local

Stack: Postgres 16 (2 database: `outline`, `hd_document_apps`), Redis 7, Outline `1.10.1` (pin digest), `oidc-bridge` (build từ `apps/oidc-bridge`).
File đính kèm của Outline lưu local trên volume `outline-file-storage` (không dùng MinIO: image chính thức không còn pull được).

Cần: Docker Desktop / Docker Engine + Compose v2, Node 22 (`.nvmrc`), pnpm 10.

Port mặc định: Outline `3000`, bridge `4001` (4000 dành cho ERP / erp-fake), Postgres theo `POSTGRES_HOST_PORT`. Tất cả chỉ nghe trên `127.0.0.1`.

## Chạy lần đầu

```sh
pnpm install
cd infra
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

Điền `infra/.env`:

1. Mật khẩu + secret (`openssl rand -hex 32`): `POSTGRES_PASSWORD`, `OUTLINE_DB_PASSWORD`, `APP_DB_PASSWORD`, `BRIDGE_DB_PASSWORD`, `PERMISSION_API_DB_PASSWORD`, `OUTLINE_SECRET_KEY`, `OUTLINE_UTILS_SECRET`, `OIDC_CLIENT_SECRET`, `BRIDGE_COOKIE_KEYS`.
2. Khóa ký của bridge (dán nguyên dòng lệnh in ra):
   ```sh
   pnpm --filter @hd-document/oidc-bridge generate:signing-jwks
   ```
3. Tài khoản quản trị: `SYSTEM_ADMIN_EMAIL` + hash mật khẩu (≥ 16 ký tự; dán nguyên dòng lệnh in ra):
   ```sh
   printf '%s' '<mật khẩu>' | pnpm --filter @hd-document/oidc-bridge generate:admin-password-hash
   ```
4. Đường đăng nhập của user ERP, ít nhất 1 trong 2:
   - **IdP thật** (`UPSTREAM_OIDC_ISSUER_URL` + `UPSTREAM_OIDC_CLIENT_ID`, xem "Đăng nhập qua IdP thật"), hoặc
   - **handoff JWT của ERP**: `ERP_SSO_JWKS_URL` (erp-fake) và/hoặc `ERP_SSO_PUBLIC_KEY_PEM` (CLI dev, xem "Đóng vai ERP").

Rồi dựng database → migration → cả stack:

```sh
docker compose up -d --wait postgres
# từ thư mục gốc repo, xem mục Migration bên dưới
pnpm --filter @hd-document/app-database migrate
cd infra && docker compose up -d --wait --build
```

Mở <http://localhost:3000>: Outline tự chuyển sang trang đăng nhập của bridge. Có IdP thật thì trang có nút "Đăng nhập SSO" (sang IdP) và form `system_admin` bên dưới; không thì chỉ có form "Đăng nhập quản trị" → đăng nhập bằng `SYSTEM_ADMIN_USERNAME`. Trên Outline mới cài, user đầu tiên đăng nhập thành admin; trên Outline đã có admin trùng `SYSTEM_ADMIN_EMAIL`, đăng nhập vào chính account đó.

## Đăng nhập qua IdP thật (idp.hdwebsoft.co)

Bridge làm relying party của IdP (authorization code + PKCE S256, `openid-client`). User chưa có phiên: Outline → bridge `/auth` → `/interaction/<uid>` (trang đăng nhập) → nút SSO `/interaction/<uid>/upstream` → IdP `connect/authorize` → bridge `/upstream/callback` → tra `permission_api.erp_users` theo `sub` của IdP → về Outline đúng doc.

Đăng ký ở IdP cho client `hd-dochub`:

| Mục | Giá trị |
|---|---|
| Redirect URI | `<BRIDGE_PUBLIC_URL>/upstream/callback` — dev: `http://localhost:4001/upstream/callback` |
| Consent Type | Implicit (first-party; Explicit sẽ hỏi consent từng user) |
| Allowed scopes | OpenID, Profile, Email (Roles chưa dùng) |
| Client secret | tùy chọn: có thì đặt `UPSTREAM_OIDC_CLIENT_SECRET`, bridge gửi `client_secret_basic`; trống = public client |

`infra/.env`: `UPSTREAM_OIDC_ISSUER_URL=https://idp.hdwebsoft.co`, `UPSTREAM_OIDC_CLIENT_ID=hd-dochub`, rồi `docker compose up -d --build oidc-bridge`.

User phải có sẵn trong `erp_users` với `erp_user_id` = `sub` của IdP (UUID), ví dụ khi dev:

```sh
pnpm --filter @hd-document/oidc-bridge dev:seed-erp-user \
  --erp-user-id 019e9bf8-8da3-75ee-a22b-ed4b3a9da25b --email khoa.tran@hdwebsoft.dev --name "Khoa Trần Văn"
```

Chưa seed → trang 403 "chưa được cấp quyền", log `auth_audit` event `upstream_login` reason `unknown_user` kèm `subject` = `erp:<sub>` (chép `sub` từ đó để seed). Lý do khác: `idp_denied` (IdP trả `error=`, xem `idpError`), `callback_invalid` (state/nonce/chữ ký sai, code hết hạn), `transaction_missing` (cookie `hd_upstream_login` hết hạn sau 10 phút hoặc đã dùng), `idp_unavailable` (bridge không gọi được IdP; khởi động bridge không cần IdP, chỉ lúc đăng nhập).

IdP chết thì nút SSO báo 503, form `system_admin` ngay dưới vẫn dùng được (break-glass).

Mật khẩu database chỉ được áp dụng khi volume `postgres-data` còn trống. Đổi mật khẩu sau đó: `ALTER ROLE ... PASSWORD` trong psql, hoặc xóa volume (mất dữ liệu).

## Migration cho app tự viết

Postgres publish ra host chỉ trên `127.0.0.1`, port theo `POSTGRES_HOST_PORT` trong `.env` (mặc định 5432; ví dụ 55432 nếu 5432 bị chiếm). Trong container vẫn là 5432. pgAdmin: host `localhost`, port = `POSTGRES_HOST_PORT`.

Từ thư mục gốc repo, bằng role owner `hd_document_apps`:

```sh
# bash
export APP_DATABASE_URL=postgres://hd_document_apps:<APP_DB_PASSWORD>@localhost:55432/hd_document_apps
# PowerShell
$env:APP_DATABASE_URL = "postgres://hd_document_apps:<APP_DB_PASSWORD>@localhost:55432/hd_document_apps"

pnpm --filter @hd-document/app-database migrate
```

Chạy lại không lỗi (`No pending migrations.`).

### Role database của app

| Role                 | Dùng cho                                                                               |
| -------------------- | -------------------------------------------------------------------------------------- |
| `hd_document_apps`   | Owner: chỉ chạy migration                                                              |
| `bridge_app`         | Runtime của oidc-bridge: bảng `bridge.*`, chỉ `SELECT` trên `permission_api.erp_users` |
| `permission_api_app` | Runtime của permission API (phase 4)                                                   |

`postgres-init/01-create-databases.sql` tạo các role này khi volume còn trống. **Volume đã có dữ liệu từ trước phase 2** (thiếu 2 role runtime → migration 0002 báo lỗi `role "bridge_app" does not exist`): chạy tay 1 lần, không cần xóa volume:

```sh
docker compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 \
  -v bridge_pw='<BRIDGE_DB_PASSWORD>' -v api_pw='<PERMISSION_API_DB_PASSWORD>' <<'SQL'
CREATE ROLE bridge_app LOGIN PASSWORD :'bridge_pw';
CREATE ROLE permission_api_app LOGIN PASSWORD :'api_pw';
GRANT CONNECT ON DATABASE hd_document_apps TO bridge_app, permission_api_app;
SQL
```

## Cấu hình + branding Outline (packages/outline-workspace-setup)

Áp tên/logo/màu + các toggle bảo mật (tắt public sharing, tắt đăng nhập email/passkey,
member không mời người/tạo collection/tạo API key, `inviteRequired`) bằng 2 script
idempotent, không fork Outline. Thứ tự cài mới, sau khi stack đã `up` và có ít nhất
1 user đăng nhập được (xem "Chạy lần đầu"):

1. Đăng nhập Outline bằng `system_admin` (form "Đăng nhập quản trị").
2. Settings → API → tạo API key mới → dán vào `infra/.env`, biến `OUTLINE_ADMIN_API_TOKEN`.
3. Điền `WORKSPACE_NAME` (bắt buộc), `WORKSPACE_LOGO_URL`/`WORKSPACE_ACCENT_COLOR`
   (tùy chọn, để trống = giữ nguyên) trong `infra/.env`.
4. Từ thư mục gốc repo, export các biến trên vào shell rồi chạy:
   ```sh
   pnpm --filter @hd-document/outline-workspace-setup apply-workspace-settings
   ```
   In diff trước/sau; không có gì đổi → thoát 0, không gọi `team.update`. Chạy lại
   bao nhiêu lần cũng an toàn.
5. Điền `PERMISSION_API_PUBLIC_URL` (URL public của permission API, phase 5), rồi:
   ```sh
   pnpm --filter @hd-document/outline-workspace-setup register-oauth-client
   ```
   Tạo (hoặc cập nhật `redirectUris` của) OAuth client `hd-document-permission-api`.
   `clientSecret` chỉ in ra đúng 1 lần lúc tạo mới — dán ngay vào `infra/.env`
   (`OUTLINE_OAUTH_CLIENT_ID`/`OUTLINE_OAUTH_CLIENT_SECRET`); mất thì phải tạo client mới.
6. Kiểm bằng mắt trên Outline: tên/logo/màu đúng, ngôn ngữ đúng `DEFAULT_LANGUAGE`,
   không còn nút đăng nhập email/passkey, member không thấy nút mời người/tạo
   collection, link share công khai đã tắt.

`OUTLINE_ADMIN_API_TOKEN` chỉ dùng cho 2 script trên: không log, không commit,
không phải key break-glass (key đó cất offline riêng, xem rủi ro bridge chết ở
mục "Quy định vận hành").

## Đóng vai ERP khi dev (SSO 1 click, handoff JWT)

Đường thứ hai, độc lập với IdP thật (có thể bật cả hai; để trống cả `ERP_SSO_JWKS_URL` lẫn `ERP_SSO_PUBLIC_KEY_PEM` thì route `/sso` tắt). Bridge chỉ cho user ERP đã có trong `permission_api.erp_users` (phase 4 sẽ ghi bảng này qua API provision; hiện dùng CLI). Cả 3 lệnh từ chối chạy khi `NODE_ENV=production`.

```sh
# 1 lần: sinh khóa ES256 của "ERP giả" → dán dòng ERP_SSO_PUBLIC_KEY_PEM vào infra/.env,
# rồi docker compose up -d oidc-bridge
pnpm --filter @hd-document/oidc-bridge dev:generate-erp-keypair

# seed user (APP_DATABASE_URL như mục Migration)
pnpm --filter @hd-document/oidc-bridge dev:seed-erp-user \
  --erp-user-id u-001 --email an@example.com --name "Nguyễn An"

# ký link (sống 60 giây, dùng 1 lần); --issuer phải bằng ERP_SSO_ISSUER
pnpm --silent --filter @hd-document/oidc-bridge dev:sign-sso-link \
  --erp-user-id u-001 --issuer erp-fake --return-to http://localhost:3000/doc/<slug>
```

Link `/sso` chỉ được nhận khi mở **từ một trang của ERP** (header `Referer` thuộc `SSO_ALLOWED_REFERRER_ORIGINS`). Dán thẳng link vào thanh địa chỉ sẽ bị từ chối; khi thử tay, đặt `SSO_REQUIRE_REFERRER=false` rồi `docker compose up -d oidc-bridge`.

Dùng với **erp-fake**: `ERP_SSO_ISSUER=erp-fake`, `ERP_SSO_JWKS_URL=http://host.docker.internal:4000/.well-known/jwks.json`, và seed từng user của erp-fake với `--erp-user-id` = `_id` của user đó (chính là `sub` trong JWT; xem dòng `auth_audit` trong log bridge khi bị từ chối `unknown_user`). **Không** tự đặt id kiểu `bob-it`: bridge tra đúng chuỗi `sub`.

Nút **"Đăng nhập qua ERP"** trên form login của bridge (hiện khi có `ERP_PORTAL_URL`) đưa user tới `<ERP_PORTAL_URL>/sso/start?returnTo=<OUTLINE_URL>`. ERP phải render 1 trang rồi điều hướng bằng `window.location` sang `/sso` của bridge (erp-fake: `public/sso-start.html`); ERP trả 302 thẳng thì Referer vẫn là bridge → bị từ chối `referrer_not_allowed`.

Vì sao một lần SSO bị từ chối: `docker compose logs oidc-bridge | grep auth_audit` (hoặc bảng `bridge.auth_audit_log`). Lý do thường gặp: `referrer_missing` / `referrer_not_allowed`, `token_signature_invalid` (sai khóa / sai `ERP_SSO_ISSUER`), `token_expired` (lệch đồng hồ > 30 giây), `token_replayed`, `unknown_user`, `deactivated`.

## Test

```sh
pnpm typecheck && pnpm lint && pnpm test
```

Có `APP_DATABASE_URL` (owner) thì chạy thêm test tích hợp migration; có thêm `BRIDGE_DATABASE_URL` (`postgres://bridge_app:<BRIDGE_DB_PASSWORD>@localhost:<port>/hd_document_apps`) thì chạy test tích hợp của bridge trên Postgres thật (cần migration đã chạy).

E2E (Playwright, cần cả stack đang chạy + khóa CLI dev đã cấu hình ở mục trên):

```sh
cp tests/e2e/.env.example tests/e2e/.env   # điền mật khẩu gốc của system_admin
pnpm --filter @hd-document/e2e e2e:install-browser   # 1 lần
pnpm e2e
```

Chạy E2E nhiều lần trong cùng 1 phút mà trang trắng / lỗi 429: đó là rate limit của Outline (1000 request/phút/IP, tính cả file tĩnh). Đặt `OUTLINE_RATE_LIMITER_REQUESTS=10000` trong `infra/.env` rồi `docker compose up -d outline`.

E2E tạo trong Outline 1 collection `E2E SSO handoff` (private), 1 doc và 1 user `e2e-sso-user@hd-document.test`; chạy lại không sinh trùng.

## Backup tay

```sh
docker compose run --rm backup
```

Stack phải đang chạy (service `backup` không tự khởi động Postgres). Kết quả trong `infra/backup-output/<timestamp UTC>/` (đã gitignore):

- `postgres/outline.dump`, `postgres/hd_document_apps.dump` — định dạng custom của `pg_dump`, restore bằng `pg_restore`.
- `outline-file-storage/outline-file-storage.tar.gz` — toàn bộ file đính kèm.
- `COMPLETE` — chỉ có khi mọi bước xong. Thư mục thiếu file này là backup hỏng, không dùng để restore.

File dump chứa secret: chỉ owner đọc được (umask 077), không chép ra nơi chia sẻ.

Lịch backup tự động + diễn tập restore: phase 6.

## Quy định vận hành

- **Không move doc đang có share riêng.** Outline 1.10.1 chưa có bản vá PR #13879 (PR còn mở): move doc cha làm doc con mất quyền kế thừa từ share của doc cha.
- Nâng cấp Outline: đổi cả tag lẫn digest trong `docker-compose.yml`, đối chiếu `.env.sample` của tag mới, backup trước.
- Database `outline` chỉ Outline được đụng. App tự viết dùng `hd_document_apps` (các role của app không có quyền CONNECT vào `outline`).
- Đổi file compose hoặc override thì dùng cùng bộ `-f` cho mọi lệnh `up` sau đó; `up` với bộ file khác sẽ dựng lại container.
- **Bridge chết thì không ai đăng nhập được Outline** (phiên đang có vẫn dùng tiếp). Bridge chỉ phụ thuộc Postgres; có healthcheck + tự restart.
- **Giữ nguyên `BRIDGE_SIGNING_JWKS` và `OIDC_CLIENT_SECRET`** qua các lần deploy. Outline cứ vài phút lại hỏi bridge (`/me`) bằng token đã lưu lúc đăng nhập; token sống 90 ngày và nằm trong Postgres (`bridge.oidc_payloads`) → xóa bảng này là mọi user bị đăng xuất khỏi Outline.
- User ERP chuyển sang `deactivated` trong `erp_users` → mất phiên Outline ở lần kiểm kế tiếp (trong vài phút), không cần thao tác trên Outline.
- Đồng hồ ERP và bridge lệch quá 30 giây thì token handoff bị từ chối → bật NTP ở cả hai.
- Một trình duyệt đang có phiên Outline của user A mà bấm link SSO của user B: vẫn mở bằng user A (Outline không hỏi lại bridge). Đăng xuất Outline trước khi đổi user trên máy dùng chung.

## Dọn

```sh
docker compose down        # giữ dữ liệu
docker compose down -v     # xóa cả volume (mất dữ liệu)
```
