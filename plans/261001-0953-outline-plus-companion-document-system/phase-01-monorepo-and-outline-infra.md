# Phase 01: Monorepo + hạ tầng Outline

## Context Links

- [plan.md](./plan.md)
- [research 01](./research/researcher-01-outline-selfhost-and-api.md) mục 1
- [research 02](./research/researcher-02-oidc-provider-and-claude-api.md) Topic 4
- Quy tắc: `.claude/rules/development-rules.md`

## Overview

- Ngày: 2026-10-01
- Mô tả: dựng khung pnpm workspaces, docker compose cho Outline + Postgres + Redis + MinIO, database riêng cho app tự viết, khung backup.
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 24h (3 ngày)

## Key Insights

- pnpm workspaces là đủ cho 2 app + 4 package (MVP 2 thêm 1 app). Không Turborepo (YAGNI).
- 1 instance Postgres, 2 database: `outline` (của Outline, không đụng) và `hd_document_apps` (schema `bridge`, `companion`). Không dùng chung Redis của Outline cho app tự viết.
- Outline pin tag stable mới nhất có PR #13879 (tra release notes lúc dựng), kèm digest image. Không có release nào chứa → dùng stable mới nhất + quy định "không move doc đang có share riêng". Không build từ `main`.
- Tên biến S3 của Outline lấy từ `.env.sample` của đúng tag đang pin, không đoán. MinIO không chạy được → lưu file local (volume), backup bằng copy volume.
- Không có phase spike: các điểm trên là giả định. Tag + compose kiểm ở bước 9; upload file chỉ kiểm được khi đã login (phase 2, bước 12).

## Requirements

Chức năng:
- `pnpm install`, `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` chạy được trên Windows + Linux.
- `docker compose up` ở `infra/` → Outline lên, upload file đính kèm được.
- Migration tạo schema `bridge`, `companion`.
- Script backup Postgres + MinIO chạy được bằng tay.

Phi chức năng:
- Không secret trong git; có `.env.example` đầy đủ.
- File code < 200 dòng, tên kebab-case mô tả rõ.

## Architecture

```
/                      pnpm-workspace.yaml, tsconfig.base.json, eslint, vitest
apps/                  (rỗng ở phase này, thêm ở phase 2-4)
packages/app-database/ migration SQL + pool factory (pg)
infra/                 docker-compose.yml, .env.example, postgres-init/, backup/
```

- Migration: `node-pg-migrate` + file SQL thuần. Không ORM (vài bảng, YAGNI).
- Backup chạy trong container (service `backup` gọi bằng `docker compose run`) → không phụ thuộc shell của host.
- TLS/reverse proxy: giả định local chạy HTTP được. Phase 2 phát hiện Outline đòi HTTPS cho issuer/callback → thêm reverse proxy TLS (cert tự ký) vào compose; production chờ câu hỏi deploy.

## Related Code Files

Tạo:
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `.editorconfig`
- `eslint.config.mjs`, `vitest.workspace.ts`
- `.gitignore` (sửa: thêm `.env*`, `infra/backup-output/`)
- `packages/app-database/package.json`
- `packages/app-database/src/create-postgres-pool.ts`
- `packages/app-database/src/run-migrations-cli.ts`
- `packages/app-database/migrations/0001-create-bridge-and-companion-schemas.sql`
- `infra/docker-compose.yml`
- `infra/.env.example`
- `infra/postgres-init/01-create-databases.sql`
- `infra/minio-init/create-outline-bucket.sh`
- `infra/backup/backup-postgres-databases.sh`
- `infra/backup/backup-minio-bucket.sh`
- `infra/README.md` (cách chạy local)
- `.github/workflows/ci-lint-typecheck-test.yml`

Sửa / xóa: không.

## Implementation Steps

1. Khởi tạo root: `package.json` (private, scripts `typecheck|lint|test` gọi `pnpm -r`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.nvmrc` theo `engines` trong `package.json` của `oidc-provider` 9.x.
2. `tsconfig.base.json` strict; mỗi package extends. ESLint flat config + Prettier mặc định. Vitest workspace.
3. `infra/docker-compose.yml`: service `postgres`, `redis`, `minio`, `minio-init` (tạo bucket), `outline` (image pin tag + digest). Healthcheck cho postgres/redis/minio; `outline` depends_on healthy. Volume đặt tên rõ.
4. `infra/postgres-init/01-create-databases.sql`: tạo database `outline`, `hd_document_apps` + role riêng cho từng database.
5. `infra/.env.example`: nhóm biến theo service, chú thích cách sinh secret (`openssl rand -hex 32`). Biến OIDC của Outline để trống tới phase 2.
6. `packages/app-database`: pool factory đọc `APP_DATABASE_URL`; CLI chạy migration; migration 0001 tạo 2 schema.
7. Backup: `pg_dump` cả 2 database (định dạng custom) + `mc mirror` bucket → thư mục output có timestamp. Chưa lên lịch (phase 7).
8. CI: install → typecheck → lint → test. Chưa build image.
9. Kiểm: compose up sạch từ volume trống; Outline mở được trang đăng nhập (chưa login được vì chưa có bridge là đúng); chạy migration; chạy backup tay.

## Todo List

- [ ] Root workspace + tsconfig + eslint + vitest
- [ ] docker compose (postgres, redis, minio, outline pin)
- [ ] Init database + role
- [ ] `.env.example` đủ biến
- [ ] `packages/app-database` + migration 0001
- [ ] Script backup Postgres + MinIO
- [ ] CI workflow
- [ ] `infra/README.md`
- [ ] Kiểm tra từ volume trống

## Success Criteria

- Máy sạch: clone → copy `.env.example` → `docker compose up` → Outline phản hồi HTTP 200 ở trang login.
- `pnpm -r typecheck && pnpm -r lint && pnpm -r test` xanh.
- Migration chạy lại lần 2 không lỗi (idempotent).
- Backup tay sinh ra file dump + bản sao bucket.

## Risk Assessment

- Docker Desktop Windows: volume chậm, line ending CRLF làm hỏng script `.sh` → `.gitattributes` ép LF cho `infra/**/*.sh`.
- Sai tên biến S3 → Outline không upload được: đối chiếu `.env.sample` của Outline; upload thử PDF ở phase 2 (bước 12) khi đã login được.
- Tag Outline không có digest cố định → ghi digest vào compose.

## Security Considerations

- Postgres, Redis, MinIO không publish port ra ngoài mạng docker (chỉ mở khi dev cần, qua override file).
- Role DB riêng cho Outline và cho app; app không có quyền trên database `outline`.
- Secret chỉ qua env; `.env` trong `.gitignore`.

## Next Steps

- Phase 2 thêm service `oidc-bridge` vào compose và điền biến OIDC cho Outline.
- Phase 7 hoàn thiện lịch backup + diễn tập restore.
