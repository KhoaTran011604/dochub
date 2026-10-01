# Phase 00: Spike & kiểm chứng rủi ro

## Context Links

- [plan.md](./plan.md)
- [brainstorm](../reports/brainstorm-261001-0953-outline-plus-companion-document-system.md) mục 3, 5
- [research 01: Outline](./research/researcher-01-outline-selfhost-and-api.md)
- [research 02: oidc-provider + Claude](./research/researcher-02-oidc-provider-and-claude-api.md)

## Overview

- Ngày: 2026-10-01
- Mô tả: chạy thật Outline + PoC bridge + gọi thử proxy để biến mọi mục UNVERIFIED thành quyết định có bằng chứng. Code spike là đồ bỏ, chỉ giữ ghi chép.
- Priority: P1 (cổng cho toàn plan)
- Implementation status: Pending
- Review status: Chưa review
- Effort: 40h (5 ngày)

## Key Insights

- Research chỉ CONFIRMED: stack docker (Postgres 16+, Redis 7, MinIO), env OIDC của Outline, PR #13879 và #13857 đã merge, argon2id OWASP params, `oidc-provider` 9.12.2, model id Claude, pnpm workspaces. Phần còn lại là suy đoán.
- 3 mục có thể đổi kiến trúc: S5 (OAuth thay mặt user), S7 (oidc-provider dùng được không), S12 (proxy).
- Không tin tài liệu: mỗi mục phải có lệnh/curl/ảnh chụp chứng minh, ghi vào báo cáo.

## Requirements

- Mỗi mục checklist kết thúc bằng 1 trong: `XÁC NHẬN` / `DÙNG FALLBACK` / `CHẶN (cần user quyết)`.
- Báo cáo: `plans/261001-0953-outline-plus-companion-document-system/reports/spike-findings-report.md`.
- Không viết code production trong phase này.

## Architecture

Môi trường spike (local, Docker Desktop trên Windows):

```
docker compose: outline + postgres + redis + minio
PoC bridge: 1 file Node dùng oidc-provider, account cứng trong code
curl / script nhỏ gọi Outline API + Claude proxy
```

## Related Code Files

Tạo (tạm, thư mục `spike/` không commit hoặc xóa sau phase):
- `spike/docker-compose.yml`, `spike/.env`
- `spike/poc-oidc-bridge.mjs`
- `spike/outline-api-probes.http` (hoặc script curl)
- `spike/claude-proxy-probe.mjs`

Tạo (giữ lại):
- `plans/261001-0953-outline-plus-companion-document-system/reports/spike-findings-report.md`

## Implementation Steps

Checklist spike. Mỗi mục: việc cần làm → fallback nếu thất bại.

**S1. Version Outline chứa PR #13879**
- Xem tag/release notes trên GitHub theo ngày merge; chạy bản đó; test tay: share doc cha cho user B, move doc cha, kiểm doc con còn quyền.
- Fallback: không có release nào chứa → dùng bản stable mới nhất + quy định "không move doc đang có share riêng" + test hồi quy cảnh báo ở phase 7. Không build từ `main`.

**S2. Admin đầu tiên với OIDC-only**
- Cài mới, login OIDC lần đầu bằng account PoC: có thành admin không? Thử `users.update_role`.
- Fallback theo thứ tự: (a) quy trình cài đặt bắt buộc `system_admin` login đầu tiên; (b) promote qua `users.update_role` bằng API key admin khác; (c) cập nhật role trực tiếp trong Postgres, ghi vào runbook như biện pháp cuối.

**S3. `users.invite` + khớp email khi login OIDC**
- Invite email X, login OIDC bằng X: có ghép vào user đã invite không, có tạo trùng không.
- Fallback: sync job bỏ qua user chưa tồn tại trong Outline, ghi log `pending_first_login`, chu kỳ reconcile sau sẽ áp quyền.

**S4. Response `documents.create` + format link**
- Gọi thật, ghi lại schema: `id`, `url`, `urlId`. Xác định URL mở được trong trình duyệt.
- Fallback: không có `url` → ghép từ `urlId` theo format quan sát được, hoặc gọi thêm `documents.info`.

**S5. OAuth app của Outline trên self-host**
- Tìm nơi đăng ký app, endpoint authorize/token, scope, PKCE, refresh token, hạn token. Chạy trọn luồng authorization code, gọi `auth.info` và `documents.list` bằng token user; xác nhận user không đọc được doc ngoài quyền.
- <!-- Updated: Validation Session 1 - endpoint bên thứ 3 tạo doc dưới tên user ERP thật --> Kiểm thêm: refresh token có dùng offline được không (user không online), hạn bao lâu, có xoay vòng không; dùng token user tạo doc → tác giả hiển thị đúng user. Kết quả quyết định endpoint bên thứ 3 ở phase 4 tạo ngay được hay chỉ trả link tạo-khi-mở.
- Fallback A: API key theo user (user tự tạo trong Outline, dán vào companion, lưu mã hóa). UX kém nhưng quyền vẫn do Outline ép.
- Fallback B: companion login qua bridge (OIDC client thứ 2) + admin token + kiểm quyền tường minh trước mỗi lần đọc/ghi. Rủi ro cao nhất, chỉ dùng khi A không được; cần thêm 1 spike nhỏ về API kiểm quyền.

**S6. Rate limit Outline API**
- Bắn 200 request liên tiếp, ghi header rate limit, ngưỡng 429, `Retry-After`; theo token hay theo IP.
- Fallback: không đo được rõ → client tự giới hạn (tuần tự + backoff theo `Retry-After`), sync chia lô nhỏ.

**S7. `oidc-provider` 9.x**
- Đọc `package.json` (engines) → chốt version Node cho cả repo.
- PoC: luồng interaction login tự viết; bỏ consent cho client first-party; adapter Postgres (1 bảng payload JSONB); JWKS từ env; cookie keys; redirect URI `{outline}/auth/oidc.callback`.
- Fallback từng phần: consent không bỏ được → tự động hoàn tất consent trong interaction handler; adapter → viết theo ví dụ adapter trong repo oidc-provider. Fallback toàn phần (thư viện không dùng được): Keycloak/Authentik + đồng bộ user, báo user quyết vì đổi phạm vi phase 2.

**S8. Hợp đồng OIDC phía Outline**
- Claim Outline cần (`sub`, `email`, `name`, `preferred_username`); đọc từ id_token hay userinfo; `OIDC_ISSUER_URL` discovery chạy với bridge không; Outline có đòi HTTPS cho issuer/callback ở local không; đổi email ở ERP thì Outline xử lý sao.
- Fallback: discovery lỗi → khai báo tay `OIDC_AUTH_URI/TOKEN_URI/USERINFO_URI`. Cần HTTPS → reverse proxy TLS local (cert tự ký) từ phase 1.

**S9. Placeholder đi qua markdown của Outline**
- Soạn doc chứa `{{ten_bien:text}}`, `{{trang_thai:select(a|b|c)}}` trong editor; lấy `documents.info`; xem ký tự `_ { } | ( )` có bị escape/đổi không.
- Fallback: parser bỏ escape `\` trước khi dò; nếu vẫn hỏng → quy định tên biến camelCase và/hoặc đặt placeholder trong inline code.

**S10. Admin API cho sync**
- Tạo API key bằng account admin (scope, hạn). Gọi thật: `groups.create`, `groups.add_user`, `groups.remove_user`, `collections.add_group` (giá trị permission hợp lệ), `collections.create` (collection private), `users.list` lọc theo email, `users.suspend`, kích hoạt lại user.
- Fallback: endpoint nào thiếu/khác tên → ghi lại tên đúng; không có kích hoạt lại → runbook thao tác tay.

**S11. Kế thừa quyền khi share document**
- Share doc cha cho user ngoài collection: thấy cha + mọi con, không thấy doc anh em/ngoài nhánh; doc con tạo sau khi share có được kế thừa không; hiển thị ở đâu trong sidebar.
- Fallback: không có. Sai khác với yêu cầu #5 → CHẶN, báo user (điều kiện xem lại quyết định, brainstorm mục 8).

**S12. Claude proxy**
- <!-- Updated: Validation Session 1 - user xác nhận proxy theo Anthropic Messages API --> Định dạng Messages API đã được user xác nhận; spike chỉ còn kiểm streaming, caching và các tham số bên dưới.
- Gọi `messages` qua `@anthropic-ai/sdk` + `baseURL`: non-stream, stream, `cache_control` (xem `usage.cache_read_input_tokens` ở lần gọi 2), model id nào dùng được, có nhận `thinking: {type:"adaptive"}`, `output_config.effort`, beta header không; `stop_reason: "refusal"` có được trả nguyên không.
- Fallback: không stream → gọi thường + spinner; không cache → chấp nhận chi phí, ghi vào ngân sách; không nhận tham số nào → bỏ tham số đó trong module client; không tương thích Messages API → CHẶN, hỏi user.

**S13. File đính kèm qua MinIO**
- Tra `.env.sample` của Outline lấy tên biến S3; upload PDF + Word, tải lại qua hostname công khai.
- Fallback: lưu file local (volume) thay MinIO, backup bằng copy volume.

**S14. Ghi nhận (không chặn)**
- Release nào chứa PR #13857 (group claim). Chỉ ghi lại, không dùng làm cơ chế chính.

Cuối phase: viết báo cáo, cập nhật các phase file bị ảnh hưởng, đánh dấu câu hỏi cần user quyết.

## Todo List

- [ ] Dựng Outline local (compose spike)
- [ ] S1 version + test move document
- [ ] S2 admin đầu tiên
- [ ] S3 invite + khớp email
- [ ] S4 response `documents.create`
- [ ] S5 OAuth app self-host (trọn luồng)
- [ ] S6 rate limit
- [ ] S7 PoC oidc-provider (login, consent, adapter, keys)
- [ ] S8 hợp đồng claim OIDC + HTTPS local
- [ ] S9 placeholder round-trip
- [ ] S10 admin API cho sync
- [ ] S11 kế thừa quyền share
- [ ] S12 Claude proxy
- [ ] S13 MinIO attachments
- [ ] S14 ghi nhận PR #13857
- [ ] Viết `spike-findings-report.md`, cập nhật phase 1-6 theo kết quả

## Success Criteria

- 14 mục đều có trạng thái + bằng chứng (lệnh, response rút gọn).
- Chốt: tag Outline, version Node, phương án auth companion (OAuth / A / B), cú pháp placeholder cuối.
- Không còn mục CHẶN chưa có người quyết trước khi vào phase 2.

## Risk Assessment

- S5 thất bại → phase 4 tăng 2-4 ngày (fallback A) hoặc 4-6 ngày (fallback B).
- S7 thất bại toàn phần → phase 2 phải plan lại.
- Spike kéo dài: timebox 5 ngày; mục nào quá 1 ngày chưa ra → lấy fallback, đi tiếp.

## Security Considerations

- Secret spike (client secret, API key, key proxy) chỉ ở `.env` local, không commit. `.gitignore` phải có `spike/`, `.env*`.
- Không dùng tài liệu thật khi thử proxy Claude (chính sách dữ liệu chưa chốt).

## Next Steps

- Phase 1 dùng tag Outline + version Node đã chốt.
- Câu hỏi CHẶN chuyển cho user trước phase 2.
