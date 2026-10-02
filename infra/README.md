# infra — chạy Outline local

Stack: Postgres 16 (2 database: `outline`, `hd_document_apps`), Redis 7, Outline `1.10.1` (pin digest).
File đính kèm của Outline lưu local trên volume `outline-file-storage` (không dùng MinIO: image chính thức không còn pull được).

Cần: Docker Desktop / Docker Engine + Compose v2, Node 22 (`.nvmrc`), pnpm 10.

## Chạy lần đầu

```sh
cd infra
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
# điền POSTGRES_PASSWORD, OUTLINE_DB_PASSWORD, APP_DB_PASSWORD,
# OUTLINE_SECRET_KEY, OUTLINE_UTILS_SECRET (openssl rand -hex 32)
docker compose up -d --wait
```

Mở <http://localhost:3000> → trang đăng nhập Outline. Chưa có nút đăng nhập là đúng: OIDC điền ở phase 2 (oidc-bridge).

Outline mặc định chỉ nghe trên `127.0.0.1` (HTTP không mã hóa). Cho máy khác trong mạng vào thẳng: đặt `OUTLINE_BIND_ADDRESS=0.0.0.0` trong `.env`.

Mật khẩu database chỉ được áp dụng khi volume `postgres-data` còn trống. Đổi mật khẩu sau đó: `ALTER ROLE ... PASSWORD` trong psql, hoặc xóa volume (mất dữ liệu).

## Migration cho app tự viết

Postgres publish ra host chỉ trên `127.0.0.1`, port theo `POSTGRES_HOST_PORT` trong `.env` (mặc định 5432; ví dụ 55432 nếu 5432 bị chiếm). Trong container vẫn là 5432. pgAdmin: host `localhost`, port = `POSTGRES_HOST_PORT`.

Từ thư mục gốc repo:

```sh
# bash
export APP_DATABASE_URL=postgres://hd_document_apps:<APP_DB_PASSWORD>@localhost:55432/hd_document_apps
# PowerShell
$env:APP_DATABASE_URL = "postgres://hd_document_apps:<APP_DB_PASSWORD>@localhost:55432/hd_document_apps"

pnpm --filter @hd-document/app-database migrate
```

Chạy lại không lỗi (`No pending migrations.`). Có `APP_DATABASE_URL` thì `pnpm test` chạy thêm test tích hợp migration.

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
- Database `outline` chỉ Outline được đụng. App tự viết dùng `hd_document_apps` (role `hd_document_apps` không có quyền CONNECT vào `outline`).
- Đổi file compose hoặc override thì dùng cùng bộ `-f` cho mọi lệnh `up` sau đó; `up` với bộ file khác sẽ dựng lại container.

## Dọn

```sh
docker compose down        # giữ dữ liệu
docker compose down -v     # xóa cả volume (mất dữ liệu)
```
