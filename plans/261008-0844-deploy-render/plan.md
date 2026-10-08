---
title: "Deploy stack lên Render (staging/test) bằng Blueprint"
description: "Thêm render.yaml (outline + oidc-bridge + permission-api, free tier, Neon + Upstash) và runbook bootstrap trong infra/README.md"
status: pending
priority: P2
effort: 2.5h
branch: khoatran/deploy-app
tags: [infra, deploy, render, staging]
created: 2026-10-08
---

# Deploy lên Render (staging/test)

Config/infra only. Không đổi code app (cả 2 app đọc `PORT` động qua zod).

## Quyết định đã chốt
- DB: Neon (đã migrate/kết nối). Redis: Upstash `rediss://`. Không deploy `postgres`/`redis`/`backup`.
- Tier staging, `plan: free` cả 3 service, URL mặc định `*.onrender.com`, giữ nguyên IdP issuer trong `infra/.env`.
- `FILE_STORAGE: local`, KHÔNG disk, KHÔNG S3 → file đính kèm mất khi redeploy/restart/spin-down (known gap).
- URL liên service = URL public `https://<name>.onrender.com` (không dùng `fromService`: chỉ trả host:port private, zod cần full `https://`).

## Tên service (dùng xuyên suốt)
| Service | Render name | URL | PORT | Health |
|---|---|---|---|---|
| Outline (image) | `hd-outline` | `https://hd-outline.onrender.com` | 3000 | `/_health` |
| oidc-bridge (docker) | `hd-oidc-bridge` | `https://hd-oidc-bridge.onrender.com` | 4001 | `/healthz` |
| permission-api (docker) | `hd-permission-api` | `https://hd-permission-api.onrender.com` | 4100 | `/healthz` |

Nếu tên bị chiếm, Render thêm hậu tố ngẫu nhiên → phải sửa lại mọi URL hardcode (xem risk ở phase 01).

## Phases
| # | Phase | Status | Effort | File |
|---|---|---|---|---|
| 01 | Viết `render.yaml` ở root | pending | 1h | [phase-01-render-yaml.md](phase-01-render-yaml.md) |
| 02 | Runbook trong `infra/README.md` + review + changelog | pending | 1.5h | [phase-02-readme-runbook-review-changelog.md](phase-02-readme-runbook-review-changelog.md) |

## Files
- Create: `render.yaml` (root) — file mới duy nhất.
- Modify: `infra/README.md` (thêm mục "Deploy lên Render (staging/test)"), `docs/project-changelog.md` (1 dòng).
- Không đụng: `apps/**`, `infra/docker-compose.yml`, Dockerfile.

## Dependencies
- Phase 02 tham chiếu tên service/biến của phase 01 → làm tuần tự.
- Ngoài repo (user tự làm): thêm redirect URI `https://hd-oidc-bridge.onrender.com/upstream/callback` ở IdP client `hd-dochub`.
- Sau implement: `code-reviewer` review diff; `docs-manager` thêm changelog.

## Out of scope (YAGNI)
S3/R2, Render disk, custom domain, autoscale, tách staging/prod, deploy erp-fake, sửa code app, CI deploy.

## Unresolved questions
1. Free tier 512MB RAM có đủ cho Outline 1.10.1 không? Nếu OOM/crash-loop → nâng riêng `hd-outline` lên `starter` (cần user đồng ý chi phí).
2. Bridge free spin-down sau 15' idle: Outline gọi `/me` server-side khi bridge đang ngủ (cold start ~30-60s) có thể timeout → user bị đá phiên. Chấp nhận cho test hay nâng bridge lên `starter`?
3. Region: chọn `singapore` — cần khớp region Neon/Upstash user đã tạo (user xác nhận).
4. Lần deploy này có cần key `erp-fake` (`HD_PERMISSION_API_SERVICE_KEY`) trỏ vào permission-api trên Render không, hay chỉ key của bridge?
