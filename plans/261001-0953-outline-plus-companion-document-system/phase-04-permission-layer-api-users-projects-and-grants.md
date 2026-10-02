# Phase 04: Permission layer API: user, dự án, cấp/thu quyền

## Context Links

- [plan.md](./plan.md) · [phase 02](./phase-02-oidc-bridge-sso-token-handoff-and-local-system-admin.md) (bảng `erp_users`) · [phase 03](./phase-03-outline-config-branding-and-api-client.md) (client, `inviteRequired`)
- [project-brief](./project-brief-tasks-spec-architecture-and-locked-stack.md) mục 3.2, 3.3
- Source Outline `v1.10.1`: `server/routes/api/users/users.ts`, `server/commands/userInviter.ts`, `server/routes/api/{documents,collections,groups}/schema.ts`

## Overview

- Ngày: 2026-10-01
- Mô tả: app headless `apps/outline-permission-api` (thay `apps/companion`, không có UI). ERP ĐẨY quyền qua API; service áp vào Outline ngay bằng admin token. Không có job kéo/sync.
- Priority: P1
- Implementation status: Pending
- Review status: Chưa review
- Effort: 56h (7 ngày)

## Key Insights

Đã kiểm trên source Outline `v1.10.1`:

- `users.invite`: body `{ invites: [{ email, name, role }], suppressEmail }`; tối đa **20 invite/request**, **50 request/giờ**; email đã tồn tại bị lọc ra (`unsent`), không lỗi. → Cần endpoint batch cho đợt nạp đầu (20 × 50 = 1000 user/giờ) và tra `users.list` khi email đã có.
- Quyền: `documents.add_user { id, userId, permission? }`, `documents.remove_user`, `collections.add_group { id, groupId, permission }`, `groups.add_user { id, userId }`, `groups.remove_user`. Enum `read | read_write | admin` cho cả collection và document. Role user: `admin | member | viewer | guest`.
- `groups.create` có `externalId` → ghi `projectKey:role` để tra ngược.
- `documents.info` trả `collectionId` → dùng để kiểm phạm vi service key với quyền mức node.

Thiết kế:

- Outline là nguồn sự thật về quyền. DB của ta chỉ giữ ánh xạ (`erp_users`, `project_collection_map`) + audit. Không lưu bản sao membership → không có gì để lệch.
- PUT/DELETE là idempotent tự nhiên → API quyền không cần `Idempotency-Key` (chỉ `POST /documents` ở phase 5 cần).
- Đổi role dự án: **gỡ khỏi group cũ trước, thêm vào group mới sau** (fail closed: lỗi giữa chừng → user mất quyền tạm, không thừa quyền). ERP gọi lại PUT là hội tụ.
- Email đổi: chỉ cập nhật `erp_users`; Outline tự ghi đè email ở lần login kế (email verified). Không invite email mới (sẽ tạo user thứ 2).
- Framework: **Koa + `@koa/router`**. Lý do: bridge buộc phải dùng Koa (`oidc-provider`), ~12 route JSON không cần hơn; 1 framework cho cả repo.

## Giả định + fallback (thử ngay ngày 1, bước 2)

| Giả định | Sai thì |
|---|---|
| `users.invite` + `suppressEmail` chạy khi không có SMTP, trả `users[].id` | Bỏ pre-provision + tắt `inviteRequired`: user tạo ở lần SSO đầu; upsert tra id qua `users.list`; cấp quyền trước lần login đầu → `409 USER_NOT_IN_OUTLINE`, ERP gọi lại sau |
| User đã invite login lần đầu qua bridge → đúng account đó (khớp email verified), quyền cấp trước vẫn còn | Như trên |
| User chỉ có quyền mức node (không thuộc collection) mở + sửa được doc và doc con | Ghi hạn chế: quyền mức node chỉ dùng kèm role dự án `viewer` trở lên |
| `collections.create` với `permission: null` cho collection private | Tạo xong gọi `collections.update` hạ quyền mặc định |
| `groups.add_user` lặp lại / `remove_user` với người không thuộc group không lỗi | Bắt lỗi tương ứng, coi là thành công |
| User role `viewer` không sửa được doc dù có `read_write` | Đã xử lý: invite luôn với role `member` |

## Requirements

Chức năng (prefix `/api/v1`, `Authorization: Bearer <service key>`):

| Method + path | Body | Kết quả | Gọi Outline |
|---|---|---|---|
| `PUT /users/{erpUserId}` | `{ email, name }` | `200 { erpUserId, outlineUserId, status }` | `users.list` theo email → thiếu thì `users.invite` (`role: member`, `suppressEmail: true`) |
| `POST /users/batch-upsert` | `{ users: [{ erpUserId, email, name }] }` ≤ 20 | `200 { results[] }` (từng user ok/lỗi) | 1 lần `users.invite` |
| `POST /users/{erpUserId}/deactivate` | – | `200` | `users.suspend` |
| `POST /users/{erpUserId}/activate` | – | `200` | `users.activate` |
| `PUT /projects/{projectKey}` | `{ name }` | `200 { projectKey, collectionId, url }` | `collections.create` + 3 × `groups.create` + 3 × `collections.add_group` |
| `PUT /projects/{projectKey}/members/{erpUserId}` | `{ role: viewer \| editor \| manager }` | `200` | `groups.remove_user` × 2 → `groups.add_user` |
| `DELETE /projects/{projectKey}/members/{erpUserId}` | – | `204` | `groups.remove_user` × 3 |
| `PUT /documents/{documentId}/members/{erpUserId}` | `{ permission: read \| read_write }` | `200` | `documents.info` (kiểm phạm vi) → `documents.add_user` |
| `DELETE /documents/{documentId}/members/{erpUserId}` | – | `204` | `documents.remove_user` |

- Quy ước dự án: 1 collection private + 3 group `<projectKey>-viewer|editor|manager` gắn quyền `read | read_write | admin`. Group do API quản, không gán tay.
- Service key: phạm vi theo `projectKey` (danh sách hoặc `*`) + scope `users:write`, `permissions:write`, `documents:create`. CLI tạo / xoay / thu hồi.
- Không bao giờ suspend hay đổi quyền `system_admin`: từ chối email trùng `SYSTEM_ADMIN_EMAIL`, từ chối `outlineUserId` của admin.
- Lỗi: `{ error: { code, message } }`; mã: 400, 401, 403, 404, 409, 429, 502 (Outline lỗi; gọi lại an toàn).

Phi chức năng:
- zod cho env + mọi input; giới hạn body 256 KB.
- Rate limit theo service key, trong bộ nhớ (chạy 1 instance; ghi rõ giới hạn này).
- Outline trả 429 → trả `429` + `Retry-After` cho ERP.
- Audit mọi request ghi: service client, hành động, đối tượng, kết quả, request id. Không ghi secret.
- try/catch ở mọi handler qua 1 middleware lỗi; không lộ chi tiết nội bộ. File < 200 dòng.

## Architecture

```
ERP ── service key ──> outline-permission-api (Koa)
        middleware: lỗi → auth key (băm, so hằng thời gian) → scope + projectKey → rate limit → zod
        ├ users/*      ─> erp_users            ─┐
        ├ projects/*   ─> project_collection_map├─ outline-api-client (admin token) ─> Outline
        └ documents/*/members                  ─┘
        audit ─> api_audit_log
```

Bảng (schema `permission_api`, migration 0003): `service_clients(id, name, key_hash, scopes[], project_keys[], created_at, revoked_at)`, `project_collection_map(project_key PK, collection_id, viewer_group_id, editor_group_id, manager_group_id, created_at)`, `api_audit_log`. `erp_users` đã có từ 0002.

Service key dạng `hdk_<clientId>_<secret 32 byte>`; lưu SHA-256 của secret (entropy cao nên không cần hash chậm).

## Related Code Files

Tạo `apps/outline-permission-api/`:
- `Dockerfile`, `package.json`, `tsconfig.json`
- `src/server.ts`
- `src/config/environment-config.ts`
- `src/http/error-handling-middleware.ts`
- `src/http/service-key-authentication-middleware.ts`
- `src/http/in-memory-rate-limit-middleware.ts`
- `src/http/validate-request-with-zod.ts`
- `src/service-clients/service-client-repository.ts`
- `src/service-clients/service-key-hashing.ts`
- `src/users/erp-user-repository.ts`
- `src/users/upsert-erp-users-service.ts`
- `src/users/set-erp-user-active-state-service.ts`
- `src/users/users-routes.ts`
- `src/projects/project-group-naming-convention.ts`
- `src/projects/project-collection-map-repository.ts`
- `src/projects/ensure-project-collection-and-groups.ts`
- `src/projects/set-project-member-role-service.ts`
- `src/projects/projects-routes.ts`
- `src/document-permissions/resolve-document-project-scope.ts`
- `src/document-permissions/set-document-member-permission-service.ts`
- `src/document-permissions/document-members-routes.ts`
- `src/audit/api-audit-logger.ts`
- `src/health/health-check-route.ts`
- `scripts/manage-service-client-key-cli.ts` (create | rotate | revoke)

Tạo `packages/outline-api-client/src/`: `users-api.ts`, `groups-api.ts`, `collections-api.ts`, `documents-api.ts` (chỉ `info`, `add_user`, `remove_user`).

Tạo: `packages/app-database/migrations/0003-create-service-client-project-map-and-audit-tables.sql`.

Sửa: `infra/docker-compose.yml` (service `outline-permission-api`, port 4100), `infra/.env.example`.

## Implementation Steps

1. Module client: users, groups, collections, documents.
2. **Ngày 1:** script thử tay với Outline thật: invite 1 user (`suppressEmail`) → cấp quyền mức node + thêm vào group → user đó SSO lần đầu (CLI phase 2) → kiểm đúng account, thấy đúng doc, sửa được. Kiểm luôn 6 giả định. Ghi kết quả vào file này.
3. Khung app: env config, middleware lỗi, `/healthz`, Dockerfile, compose.
4. Migration 0003.
5. Service key: hashing, repository, middleware auth + scope + `projectKey`; CLI quản key (in key đúng 1 lần).
6. Rate limit + giới hạn body + audit logger.
7. Users: upsert (tra `erp_users` → có thì cập nhật email/tên; chưa có thì tra Outline theo email → invite), batch, deactivate/activate. Chặn email admin. Deactivate → `erp_users.status = deactivated` (bridge từ chối SSO ngay).
8. Projects: validate `projectKey` (`^[a-z0-9][a-z0-9-]{1,40}$`), `ensure-project-collection-and-groups` (tra map → thiếu gì tạo nấy → ghi map), chạy lại an toàn.
9. Project member: gỡ trước, thêm sau; `DELETE` gỡ cả 3.
10. Document member: `resolve-document-project-scope` (`documents.info` → `collectionId` → `projectKey` → kiểm phạm vi key) → `add_user` / `remove_user`.
11. Test. Unit: naming, scope key, thứ tự gỡ/thêm, map lỗi. Tích hợp với Outline thật trong compose: viewer không sửa được; editor sửa được; user chỉ có quyền node thấy đúng nhánh, không thấy doc anh em; thu quyền có hiệu lực ngay; deactivate → không SSO được, API Outline của user bị từ chối; key ngoài phạm vi `projectKey` → 403; gọi lại mỗi endpoint 2 lần → cùng kết quả.
12. Bản nháp tài liệu API cho ERP (hoàn thiện ở phase 6).

## Todo List

- [ ] Client: users, groups, collections, documents (permission)
- [ ] Ngày 1: invite → cấp quyền → SSO lần đầu, ghi kết quả 6 giả định
- [ ] Khung app + Dockerfile + compose
- [ ] Migration 0003
- [ ] Service key: auth, scope, phạm vi dự án, CLI
- [ ] Rate limit, giới hạn body, audit
- [ ] Users: upsert, batch, deactivate, activate
- [ ] Projects: collection + 3 group
- [ ] Cấp/thu role dự án
- [ ] Cấp/thu quyền mức node
- [ ] Integration test quyền với Outline thật
- [ ] Nháp tài liệu API

## Success Criteria

- ERP provision user + cấp role → user SSO lần đầu thấy đúng dự án với đúng mức quyền, không ai phải thao tác tay trong Outline.
- Cấp quyền 1 node → user thấy node đó + node con, không thấy phần còn lại của dự án.
- Thu quyền / deactivate có hiệu lực ngay ở lần gọi API kế tiếp của user.
- Mọi endpoint gọi lại nhiều lần cho cùng kết quả, không tạo trùng user/group/collection.
- Key sai → 401; ngoài phạm vi → 403; mọi thay đổi có dòng audit.
- `system_admin` không thể bị suspend hay hạ quyền qua API.

## Risk Assessment

- Rate limit `users.invite` (50 request/giờ): nạp đầu phải dùng batch; vượt → 429 kèm `Retry-After`. Ghi vào tài liệu ERP.
- Lỗi giữa chuỗi gọi Outline → trạng thái dở. Thứ tự fail closed + mọi endpoint idempotent → ERP gọi lại. Trả `502` kèm `code` rõ.
- Move doc có quyền riêng → doc con mất quyền kế thừa (PR #13879 chưa merge): giữ quy tắc "không move doc đang có share riêng" + ghi tài liệu ERP.
- Admin thao tác tay trong Outline (thêm người vào group) → lệch với ERP. Chấp nhận; lần PUT kế của ERP ghi đè riêng user đó.
- ERP gửi email trùng user khác → 409, không ghi đè.
- Chạy 2 instance → rate limit trong bộ nhớ sai. Ghi rõ: 1 instance.

## Security Considerations

- Admin token chỉ nằm trong service này (và script phase 3); không log, không trả về.
- Service key entropy cao, lưu băm, so hằng thời gian, xoay vòng được, thu hồi được, giới hạn theo dự án + scope.
- Collection dự án private; quyền chỉ đi qua 3 group hoặc quyền mức node.
- Kiểm phạm vi dự án cho cả endpoint mức node (không tin `documentId` do ERP gửi).
- Service không publish ra internet nếu ERP gọi được qua mạng nội bộ (chốt khi biết nơi deploy).
- DB: role `permission_api_app` không đọc được bảng của bridge.

## Next Steps

- Phase 5: `POST /api/v1/documents` dùng chung khung auth/audit ở đây.
- Phase 6: tài liệu tích hợp ERP bản chính.
