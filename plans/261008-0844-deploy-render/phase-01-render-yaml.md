# Phase 01 — `render.yaml` (Blueprint) ở root

## Context Links
- Nguồn sự thật env: `infra/docker-compose.yml` (service `outline`, `oidc-bridge`, `outline-permission-api`), `infra/.env.example`
- Schema env: `apps/oidc-bridge/src/config/environment-config.ts`, `apps/outline-permission-api/src/config/environment-config.ts`
- Neon: `infra/README.md` mục "Dùng Neon (hoặc Postgres managed khác)…"
- Service keys: `plans/reports/audit-261007-2222-deploy-setup-and-service-keys.md`

## Overview
- Priority: P2 · Status: pending · Effort: 1h
- 1 file mới `render.yaml`: 3 web service, free tier, secret = `sync: false`, giá trị suy ra được = `value:`.

## Key Insights
- Dockerfile 2 app đã viết cho build context = root (`COPY pnpm-lock.yaml …`) → `dockerContext: .` chạy nguyên trạng.
- Zod `httpUrl` bắt buộc `http(s)://` → URL liên service phải là URL public đầy đủ, không `fromService`.
- Biến optional của bridge dùng `preprocess("" → undefined)`; permission-api cũng vậy cho phần lớn biến, NHƯNG `SMTP_PORT: z.coerce.number()` biến `""` thành `0` → biến không dùng thì **không khai** hoặc để unset, không đặt chuỗi rỗng.
- Bridge `superRefine`: cần `UPSTREAM_OIDC_ISSUER_URL` hoặc handoff key; Render dùng IdP thật → bỏ hết `ERP_SSO_*` (erp-fake không deploy; `host.docker.internal` vô nghĩa trên Render).
- `PERMISSION_API_SERVICE_KEY` có → bắt buộc `PERMISSION_API_INTERNAL_URL` (đặt sẵn `value:` = URL public permission-api).
- `OUTLINE_INTERNAL_URL` bỏ trống = dùng `OUTLINE_URL` → không khai (KISS).
- `OUTLINE_ADMIN_API_TOKEN` là `min(1)` bắt buộc → lần deploy đầu permission-api sẽ fail nếu trống. Cách xử lý: nhập placeholder tạm (vd. `bootstrap-pending`) lúc tạo Blueprint, thay bằng token thật ở bước bootstrap (giả định `/healthz` không gọi Outline — implementer verify nhanh trong `apps/outline-permission-api/src`; nếu có gọi thì chấp nhận deploy đầu fail).
- Outline `SECRET_KEY`/`UTILS_SECRET`: dùng `sync: false` + giá trị `openssl rand -hex 32` (không dùng `generateValue` — Outline cần hex 32 byte, `generateValue` sinh base64).
- `envVarGroups` không dùng: các biến chung (`OIDC_CLIENT_SECRET`, `SYSTEM_ADMIN_EMAIL`) là secret, giữ khai riêng từng service + ghi chú "phải giống nhau" (KISS hơn group).

## Requirements
- Functional: Render "New Blueprint" từ repo tạo được đủ 3 service; mọi biến compose của 3 service đều được map (khai, hoặc cố ý bỏ có lý do).
- Non-functional: không commit secret; header comment giải thích staging-only + gap file storage.

## Architecture
```
Browser ──https──▶ hd-outline ──(token,/me) https──▶ hd-oidc-bridge ──PUT /users──▶ hd-permission-api ──API──▶ hd-outline
                        │                                   │                                   │
                        └── Neon pooler db `outline` ───────┴── Neon pooler db `hd_document_apps` ┘
                        └── Upstash REDIS_URL (rediss://)
```
Mọi mũi tên liên service đi qua edge public của Render (TLS terminate ở edge → `TRUST_PROXY=true`, `FORCE_HTTPS=true`).

## Bảng map env (compose → render.yaml)
Ký hiệu: **S** = `sync: false` (nhập ở dashboard), **V** = `value:`, **—** = không khai (lý do).

**hd-outline**: NODE_ENV V `production` · URL V · PORT V `3000` · SECRET_KEY S · UTILS_SECRET S · DATABASE_URL S (Neon pooler, db `outline`, `?sslmode=require`) · PGSSLMODE V `require` · REDIS_URL S · FILE_STORAGE V `local` · FILE_STORAGE_LOCAL_ROOT_DIR V `/var/lib/outline/data` · FORCE_HTTPS V `true` · ENABLE_UPDATES V `false` · RATE_LIMITER_REQUESTS V `1000` · OIDC_CLIENT_ID V `outline` · OIDC_CLIENT_SECRET S · OIDC_AUTH_URI/TOKEN_URI/USERINFO_URI/LOGOUT_URI V (bridge public `/auth` `/token` `/me` `/session/end`) · OIDC_DISPLAY_NAME/USERNAME_CLAIM/SCOPES V (default compose) · DEFAULT_LANGUAGE V `en_US` (đổi nếu `.env` khác) · SMTP_HOST/PORT/USERNAME/PASSWORD/FROM_EMAIL/REPLY_EMAIL/SECURE S (để trống được) · OAUTH_DISABLE_DCR V `true`.

**hd-oidc-bridge**: NODE_ENV V · PORT V `4001` · BRIDGE_PUBLIC_URL V · BRIDGE_DATABASE_URL S (Neon pooler, role `bridge_app`) · BRIDGE_COOKIE_KEYS S · BRIDGE_SIGNING_JWKS S · TRUST_PROXY V `true` · OUTLINE_URL V · OIDC_CLIENT_ID V `outline` · OIDC_CLIENT_SECRET S (= giá trị ở hd-outline) · SYSTEM_ADMIN_USERNAME S · SYSTEM_ADMIN_EMAIL S · SYSTEM_ADMIN_DISPLAY_NAME V `System Admin` · SYSTEM_ADMIN_PASSWORD_HASH S · UPSTREAM_OIDC_ISSUER_URL S (chép y `.env`, không đổi domain) · UPSTREAM_OIDC_CLIENT_ID S · UPSTREAM_OIDC_CLIENT_SECRET S (trống = public client) · UPSTREAM_OIDC_SCOPES V · PERMISSION_API_PUBLIC_URL V · PERMISSION_API_INTERNAL_URL V (URL public permission-api) · PERMISSION_API_SERVICE_KEY S (trống lần đầu) · ERP_SSO_* — (handoff tắt, IdP thật đủ) · SSO_* — (default, chỉ dùng cho handoff) · ERP_PORTAL_URL — (erp-fake không public).

**hd-permission-api**: NODE_ENV V · PORT V `4100` · PERMISSION_API_DATABASE_URL S (Neon pooler, role `permission_api_app`) · TRUST_PROXY V `true` · OUTLINE_URL V · OUTLINE_INTERNAL_URL — (default = OUTLINE_URL) · OUTLINE_ADMIN_API_TOKEN S (placeholder lần đầu) · SYSTEM_ADMIN_EMAIL S · PERMISSION_API_PUBLIC_URL V · OUTLINE_OAUTH_CLIENT_ID S · OUTLINE_OAUTH_CLIENT_SECRET S · OUTLINE_OAUTH_SCOPE — (default) · TOKEN_SEAL_PASSWORD S (≥32 ký tự) · PENDING_REQUEST_TTL_DAYS — (default 7) · ERP_PORTAL_URL — · SMTP_HOST/PORT/USER/PASS, MAIL_FROM_EMAIL S (không dùng thì để unset, đừng nhập chuỗi rỗng cho PORT).

## Draft `render.yaml` (implementer hoàn thiện theo bảng trên)
```yaml
# Staging/test only. 3 web service free tier; Postgres = Neon, Redis = Upstash (không deploy ở đây).
# GAP: Outline FILE_STORAGE=local, không disk/S3 -> file đính kèm MẤT khi redeploy/restart/spin-down.
# URL liên service hardcode theo `name` (https://<name>.onrender.com). Đổi name -> sửa mọi URL.
# Runbook bootstrap: infra/README.md mục "Deploy lên Render (staging/test)".
services:
  - type: web
    name: hd-outline
    runtime: image
    image:
      url: docker.io/outlinewiki/outline:1.10.1@sha256:832051f039b446c87aa23929cf92c00980c66aaa2d744d118c48c016ec816ad8
    plan: free
    region: singapore
    healthCheckPath: /_health
    envVars:
      - key: NODE_ENV
        value: production
      - key: URL
        value: https://hd-outline.onrender.com
      - key: PORT
        value: "3000"
      - key: SECRET_KEY
        sync: false
      # ... phần còn lại theo bảng map
  - type: web
    name: hd-oidc-bridge
    runtime: docker
    dockerfilePath: ./apps/oidc-bridge/Dockerfile
    dockerContext: .
    plan: free
    region: singapore
    healthCheckPath: /healthz
    envVars:
      - key: PORT
        value: "4001"
      - key: BRIDGE_PUBLIC_URL
        value: https://hd-oidc-bridge.onrender.com
      - key: TRUST_PROXY
        value: "true"
      # ...
  - type: web
    name: hd-permission-api
    runtime: docker
    dockerfilePath: ./apps/outline-permission-api/Dockerfile
    dockerContext: .
    plan: free
    region: singapore
    healthCheckPath: /healthz
    envVars:
      - key: PORT
        value: "4100"
      # ...
```
Mọi `value` boolean/số phải quote (`"true"`, `"3000"`) — zod `booleanFlag` chỉ nhận chuỗi `true|false`.

## Related Code Files
- Create: `render.yaml`
- Modify/Delete: none

## Implementation Steps
1. Tạo `render.yaml` theo draft + bảng map; header comment (staging-only, gap storage, quy tắc tên↔URL).
2. Đối chiếu từng dòng `environment:` của 3 service trong compose → mỗi biến hoặc có trong yaml, hoặc thuộc nhóm "—" có lý do.
3. Verify nhanh `/healthz` của permission-api có phụ thuộc Outline/admin token không (quyết định placeholder vs chấp nhận fail lần đầu).
4. Validate YAML: `npx --yes yaml-lint render.yaml` hoặc `node -e "require('yaml').parse(...)"`; nếu có Render CLI: `render blueprints validate` (tùy chọn).
5. `git diff --stat` chỉ có `render.yaml` + (phase 02) README/changelog; grep đảm bảo không có secret literal (`grep -nE "postgres://|rediss://|hdk_|argon2" render.yaml` phải rỗng).

## Todo
- [ ] Viết `render.yaml` 3 service
- [ ] Cross-check env với compose
- [ ] Verify healthz permission-api không gọi Outline
- [ ] Validate YAML + grep secret

## Success Criteria
- YAML hợp lệ; Render Blueprint preview nhận đủ 3 service, hỏi đúng danh sách biến `sync: false`.
- Không có secret literal trong file.

## Risk Assessment
| Risk | Mitigation |
|---|---|
| Tên `hd-*` đã bị người khác chiếm trên onrender.com → Render thêm hậu tố, URL hardcode sai | Sau lần sync đầu, xem URL thật trên dashboard; lệch thì sửa `value:` URL trong yaml (search/replace 1 chỗ mỗi service) + IdP redirect URI rồi sync lại |
| Outline OOM trên free 512MB | Theo dõi log; nâng riêng `hd-outline` lên `starter` |
| Spin-down free tier: cold start, Outline gọi bridge server-side timeout | Chấp nhận cho test; ghi rõ trong README |
| Outline chạy migration nội bộ qua Neon pooler | Local đã chạy OK với pooler; nếu lỗi lock thì đổi `DATABASE_URL` sang endpoint direct |
| `generateValue`/sync nhầm làm lộ secret | Chỉ `sync: false`, không `value:` cho secret |

## Security Considerations
- Secret chỉ nhập ở Render dashboard; `render.yaml` không chứa giá trị nhạy cảm.
- `FORCE_HTTPS`/`TRUST_PROXY=true` vì TLS terminate ở edge Render (cookie secure, IP thật cho audit log).
- 3 service public internet (free không có private-only) — permission-api vẫn bảo vệ bằng service key/hash; không nới thêm gì.

## Next Steps
Phase 02: runbook README dùng đúng tên service/biến ở đây.
