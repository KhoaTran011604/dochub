# Phase 01: Monorepo + hạ tầng Outline

## Context Links

- [plan.md](./plan.md)
- [research 01](./research/researcher-01-outline-selfhost-and-api.md) mục 1
- [research 02](./research/researcher-02-oidc-provider-and-claude-api.md) Topic 4
- Quy tắc: `.claude/rules/development-rules.md`

## Overview

- Ngày: 2026-10-01
- Mô tả: dựng khung pnpm workspaces, docker compose cho Outline + Postgres + Redis với lưu trữ file cục bộ, database riêng cho app tự viết, khung backup.
- Priority: P1
- Implementation status: Done (2026-10-01)
- Review status: Reviewed (7.5/10, 0 critical, fixes applied)
- Effort: 24h (3 ngày)

## Key Insights

- pnpm workspaces là đủ cho 2 app + 4 package (MVP 2 thêm 1 app). Không Turborepo (YAGNI).
- 1 instance Postgres, 2 database: `outline` (của Outline, không đụng) và `hd_document_apps` (schema `bridge`, `companion`). Không dùng chung Redis của Outline cho app tự viết.
- Outline pin tag `1.10.1` + digest image. PR #13879 vẫn mở upstream → dùng stable + quy định "không move doc đang có share riêng" ghi trong `infra/README.md`. Không build từ `main`.
- MinIO không pull được (Docker Hub, quay.io từ chối) → lưu file local qua `FILE_STORAGE=local` vào volume `outline-file-storage`, backup bằng tar.gz của volume.
- Không có phase spike: các điểm trên là giả định. Tag + compose kiểm ở bước 9; upload file chỉ kiểm được khi đã login (phase 2, bước 12).

## Requirements

Chức năng:
- `pnpm install`, `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` chạy được trên Windows + Linux.
- `docker compose up` ở `infra/` → Outline lên, upload file đính kèm được.
- Migration tạo schema `bridge`, `companion`.
- Script backup Postgres + lưu trữ file Outline chạy được bằng tay.

Phi chức năng:
- Không secret trong git; có `.env.example` đầy đủ.
- File code < 200 dòng, tên kebab-case mô tả rõ.

## Architecture

```
/                      pnpm-workspace.yaml, tsconfig.base.json, eslint, vitest.config.ts
apps/                  (rỗng ở phase này, thêm ở phase 2-4)
packages/app-database/ migration SQL + pool factory (pg)
infra/                 docker-compose.yml, .env.example, postgres-init/, backup/
```

- Migration: `node-pg-migrate` + file SQL thuần. Không ORM (vài bảng, YAGNI).
- Backup chạy trong container (service `backup` gọi bằng `docker compose run`) → không phụ thuộc shell của host.
- Lưu trữ file Outline: volume `outline-file-storage` với `FILE_STORAGE=local` (MinIO không khả dụng).
- TLS/reverse proxy: giả định local chạy HTTP được. Phase 2 phát hiện Outline đòi HTTPS cho issuer/callback → thêm reverse proxy TLS (cert tự ký) vào compose; production chờ câu hỏi deploy.

## Related Code Files

Tạo:
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `.editorconfig`
- `eslint.config.mjs`, `vitest.config.ts`
- `.gitignore` (sửa: thêm `.env*`, `infra/backup-output/`)
- `packages/app-database/package.json`, `src/index.ts`, `src/create-postgres-pool.ts`, `src/run-migrations.ts`
- `packages/app-database/migrations/0001-create-bridge-and-companion-schemas.sql`
- `packages/app-database/test/` (unit + integration tests)
- `infra/docker-compose.yml`, `docker-compose.dev-ports.yml`
- `infra/.env.example`
- `infra/postgres-init/01-create-databases.sql`
- `infra/backup/backup-postgres-databases.sh`, `backup-outline-file-storage.sh`
- `infra/README.md` (cách chạy local)
- `.github/workflows/ci-lint-typecheck-test.yml`
- `.gitattributes`, `.prettierignore`

Sửa: không. (minio-init không tạo)

## Implementation Steps

1. Khởi tạo root: `package.json` (private, scripts `typecheck|lint|test` gọi `pnpm -r`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`), `.nvmrc` = 22 (oidc-provider 9.12.2 không khai `engines`).
2. `tsconfig.base.json` strict; mỗi package extends. ESLint flat config + Prettier mặc định. Vitest với `test.projects` trong `vitest.config.ts` (Vitest 5 bỏ `workspace.ts`).
3. `infra/docker-compose.yml`: service `postgres` (image `postgres:16`, glibc), `redis`, `outline` (pin `1.10.1` + digest, `FILE_STORAGE=local`). Healthcheck + depends_on healthy. Volume `outline-file-storage` ghi từ Outline uid 1001. Outline bind `127.0.0.1` mặc định.
4. `infra/docker-compose.dev-ports.yml`: override để mở Postgres ở dev (`127.0.0.1:55432`).
5. `infra/postgres-init/01-create-databases.sql`: tạo database `outline`, `hd_document_apps` + role riêng, REVOKE CONNECT on `postgres`.
6. `infra/.env.example`: nhóm biến theo service, chú thích cách sinh secret. Biến OIDC của Outline để trống tới phase 2.
7. `packages/app-database`: pool factory → `@hd-document/app-database/run-migrations` subpath export; migration 0001 tạo schema `bridge`, `companion`.
8. Backup: `pg_dump` cả 2 database + tar.gz volume `outline-file-storage` → thư mục output có timestamp, `COMPLETE` marker, `umask 077`.
9. CI: format:check + typecheck + lint + test, `timeout-minutes: 10`, `no-new-privileges` + log rotation cho service. Chưa build image.
10. Kiểm: compose up sạch từ volume trống; Outline phản hồi 200; chạy migration idempotent; backup restore thành công.

## Todo List

- [x] Root workspace + tsconfig + eslint + vitest.config.ts
- [x] docker compose (postgres, redis, outline pin, local file storage)
- [x] Init database + role (REVOKE CONNECT on postgres)
- [x] `.env.example` đủ biến
- [x] `packages/app-database` + migration 0001 + subpath export
- [x] Script backup Postgres + file storage (tar.gz + COMPLETE marker)
- [x] CI workflow (format:check, timeout) — chưa chạy trên GitHub
- [x] `infra/README.md`
- [x] Kiểm tra từ volume trống (clean stack, migration idempotent, backup restore)

## Success Criteria

✓ Máy sạch: clone → copy `.env.example` → `docker compose -f docker-compose.yml -f docker-compose.dev-ports.yml up` → Outline HTTP 200 + Postgres 2 database + roles riêng.
✓ `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r lint`, `pnpm format:check`, `pnpm -r test` → 0 lỗi.
✓ Migration: lần 1 tạo schema, lần 2 "No pending migrations" (idempotent).
✓ Backup restore: pg_restore vào clean DB thành công, file storage tar.gz hợp lệ.
✓ Edge case đã kiểm: script `.sh`/`.sql` có LF, `.env` + backup-output bị gitignore, role isolation, port binding, thiếu biến env thì compose từ chối chạy.
☐ **Còn mở:** upload file đính kèm trong Outline — cần login, kiểm ở phase 2 bước 12.
☐ **Còn mở:** CI workflow chạy xanh trên GitHub — chưa push.

## Risk Assessment

✓ Docker Desktop Windows: line ending → `.gitattributes` ép LF (kiểm: script có POSIX line ending).
✓ MinIO không khả dụng → dùng local file storage, upload thử khi login (phase 2 bước 12).
✓ Tag Outline: pin `1.10.1` + digest; PR #13879 chưa merged → ghi "không move doc" trong README.

## Security Considerations

✓ Postgres, Redis: không publish port (chỉ mở dev qua `docker-compose.dev-ports.yml`).
✓ Outline: bind `127.0.0.1` (không `0.0.0.0`).
✓ Role DB riêng cho Outline + app; `REVOKE CONNECT ON DATABASE postgres`; app không truy cập `outline` DB.
✓ Secret chỉ qua env; `.env` trong `.gitignore` + checked.
✓ Backup: `umask 077` (quyền file dump trên Linux chưa kiểm được — máy dev là Windows).
✓ Container: `no-new-privileges`, log rotation.
✓ Outline file storage: thư mục writable uid 1001.

## Lệch so với plan

1. **MinIO bỏ**: Docker Hub + quay.io từ chối pull image minio/minio. Fallback: `FILE_STORAGE=local` vào volume `outline-file-storage`, backup tar.gz. Không tạo `infra/minio-init/create-outline-bucket.sh` hay `infra/backup/backup-minio-bucket.sh`.

2. **PR #13879 chưa merge**: Outline pin `1.10.1` + digest. Research report 01 sai khi nói PR đã merged. Quy định "không move doc đang có share riêng" ghi trong `infra/README.md`.

3. **vitest.workspace.ts → vitest.config.ts**: Vitest 5 bỏ file `workspace.ts`. Dùng `test.projects` trong `vitest.config.ts`.

4. **Extra file**: `infra/docker-compose.dev-ports.yml`, `packages/app-database/src/index.ts`, `packages/app-database/src/run-migrations.ts`, test files, `.gitattributes`, `.prettierignore`.

5. **Review fix applied**: Outline bind `127.0.0.1`, postgres:16 glibc (không alpine), backup `umask 077` + `COMPLETE` marker, subpath export run-migrations, no-new-privileges, log rotation, `REVOKE CONNECT ON DATABASE postgres`, format:check + timeout trong CI.

6. **Không verify ở phase này**: dump file quyền Linux (dev Windows), GitHub CI workflow (chưa push).

## Next Steps

- Phase 2 thêm service `oidc-bridge` vào compose và điền biến OIDC cho Outline.
- Phase 6 (phase 7 trước Session 5) hoàn thiện lịch backup + diễn tập restore.
- **IMPORTANT**: Upload file Outline test lại ở phase 2 bước 12 khi đã login được (deferred criterion).
