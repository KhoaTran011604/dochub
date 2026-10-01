# Code review — Phase 01 (monorepo + Outline infra)

Date: 2026-10-01 · Branch: feat/phase-1 · Reviewer: code-reviewer subagent (report saved by main agent; reviewer config blocks writing .md)

**Score: 7.5/10. Critical: 0. Warnings: 7. Suggestions: 7.**
User decision: fix recommended set, defer W3/W6/S2 to phase 2.

## Warnings

| # | Finding | Where | Outcome |
|---|---|---|---|
| W1 | `docker compose run --rm backup` with base file only recreates postgres when stack was upped with override → drops port mapping, restarts DB under Outline | compose `backup.depends_on` | **Fixed**: removed `depends_on` from `backup`; verified container id unchanged + port 55432 kept |
| W2 | Outline published on `0.0.0.0:3000` over HTTP | compose `outline.ports` | **Fixed**: `${OUTLINE_BIND_ADDRESS:-127.0.0.1}`; verified `127.0.0.1:3000` |
| W3 | One DB role owns both `bridge` + `companion` → companion compromise reads bridge secrets (admin hash, sessions) | `01-create-databases.sql`, migration 0001 | **Deferred → phase 2** (design decision; matches current plan) |
| W4 | `runMigrations` re-exported from index → Next bundler pulls `node-pg-migrate`, `import.meta.dirname` breaks when bundled | `src/index.ts` | **Fixed**: subpath export `@hd-document/app-database/run-migrations` |
| W5 | Dumps world-readable on Linux; failed run leaves dir that looks complete | `backup/*.sh` | **Fixed**: `umask 077` + `COMPLETE` marker; verified failed run exits 1, no marker |
| W6 | No production run path for no-build TS packages (`tsx` only root devDep; native type stripping refuses `node_modules`); `.nvmrc` floats on 22.x | `package.json`, `.nvmrc` | **Deferred → phase 2** (decide when writing Dockerfile) |
| W7 | `postgres:16-alpine` = musl, code-point collation; switching libc later corrupts text indexes | compose | **Fixed**: `postgres:16` (Debian/glibc) for `postgres`, `backup`, CI; verified `x86_64-pc-linux-gnu`, ICU `vi-VN` available |

## Suggestions

| # | Finding | Outcome |
|---|---|---|
| S1 | App roles can CONNECT to default `postgres` database | **Fixed**: `REVOKE CONNECT ON DATABASE postgres FROM PUBLIC`; verified denied |
| S2 | ESLint not type-aware (no `no-floating-promises`) | **Deferred → phase 2** |
| S3 | CI: no `format:check`, no `timeout-minutes`; root config files not linted; CI migrates as superuser | **Partly fixed**: added `format:check` + `timeout-minutes: 10`. Root lint + non-superuser CI role not done |
| S4 | No `no-new-privileges`, no log rotation | **Fixed**: shared anchor `x-service-defaults` |
| S5 | Phase file drift (status, MinIO file list, phase-02 step 12) | Handled in finalize (project-manager) |
| S6 | Phase 2: `OIDC_AUTH_URI` resolved by browser, `TOKEN/USERINFO_URI` by Outline container → `localhost` bridge URL works for one, not other | Noted for phase 2 |
| S7 | `.env.example` char warning omits `$`, `%` | **Fixed** |

## Checked and fine

Healthcheck `-h 127.0.0.1` logic; `$$(date …)` escaping; `set -eu` + `&&` exit codes; node-pg-migrate numeric-prefix ordering, single transaction, advisory lock; `public.pgmigrations` owned by app role; file-storage volume writable by uid 1001; no credential in tracked/untracked files; root `vitest run` with `test.projects`; nothing over-engineered.

## Re-verification after fixes (clean volumes)

- Stack healthy; Outline `/` → 200.
- App role denied on `outline` and `postgres` databases.
- Migration: run 1 applies 0001, run 2 `No pending migrations.`
- `pnpm format:check / typecheck / lint` green; tests 6/6 with DB.
- Backup OK with base compose file only; `COMPLETE` written.

Not verified: file permissions of dumps on Linux (dev machine is Windows; bind mount ignores mode); CI workflow on GitHub (not pushed).

## Unresolved questions

1. W3: split DB roles (`bridge_app`, `companion_app`) or accept risk? Decide at phase 2 start — cheapest before real data.
2. W6: bridge/companion runtime in Docker images — tsx, native type stripping, or build step?
3. `docs/` scope before phase 7.
4. Production deploy target (plan question 3) decides how far W2/W5 matter beyond dev.
