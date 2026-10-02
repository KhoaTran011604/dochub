-- Up Migration
-- Bảng cho outline-permission-api (phase 4). `erp_users` đã có từ 0002.

-- Service key của ERP gọi permission API. `id` là phần clientId lộ ra trong
-- key (vd "hdk_<id>_<secret>"); chỉ lưu băm SHA-256 của secret, không lưu secret.
CREATE TABLE permission_api.service_clients (
  id           text        PRIMARY KEY,
  name         text        NOT NULL,
  key_hash     text        NOT NULL,
  scopes       text[]      NOT NULL DEFAULT '{}',
  -- '{*}' = mọi dự án. Rỗng = không có quyền trên dự án nào.
  project_keys text[]      NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);
-- Tên chỉ cần duy nhất giữa các key còn hiệu lực: xoay vòng (revoke rồi tạo
-- key mới cùng tên) không bị chặn bởi index.
CREATE UNIQUE INDEX service_clients_name_key ON permission_api.service_clients (name)
  WHERE revoked_at IS NULL;

-- Ánh xạ projectKey ↔ collection + 3 group Outline (quy ước 1 dự án = 1
-- collection private + 3 group viewer|editor|manager). Ghi đúng 1 lần sau khi
-- `ensure-project-collection-and-groups` tạo xong toàn bộ; dùng để chạy lại an
-- toàn (có map = đã tạo, bỏ qua) và để tra ngược `collectionId -> projectKey`
-- khi cấp quyền mức node.
CREATE TABLE permission_api.project_collection_map (
  project_key      text        PRIMARY KEY,
  collection_id    uuid        NOT NULL UNIQUE,
  viewer_group_id  uuid        NOT NULL,
  editor_group_id  uuid        NOT NULL,
  manager_group_id uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Chỉ thêm, không sửa/xóa: permission_api_app không có quyền UPDATE/DELETE.
CREATE TABLE permission_api.api_audit_log (
  id                 bigserial   PRIMARY KEY,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  service_client_id  text,
  action             text        NOT NULL,
  target             text,
  outcome            text        NOT NULL,
  request_id         text,
  detail             jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX api_audit_log_occurred_at_idx ON permission_api.api_audit_log (occurred_at);

GRANT SELECT, INSERT, UPDATE ON permission_api.service_clients TO permission_api_app;
GRANT SELECT, INSERT ON permission_api.project_collection_map TO permission_api_app;
GRANT SELECT, INSERT ON permission_api.api_audit_log TO permission_api_app;
GRANT USAGE ON SEQUENCE permission_api.api_audit_log_id_seq TO permission_api_app;

-- Down Migration
REVOKE USAGE ON SEQUENCE permission_api.api_audit_log_id_seq FROM permission_api_app;
REVOKE SELECT, INSERT ON permission_api.api_audit_log FROM permission_api_app;
REVOKE SELECT, INSERT ON permission_api.project_collection_map FROM permission_api_app;
REVOKE SELECT, INSERT, UPDATE ON permission_api.service_clients FROM permission_api_app;
DROP TABLE permission_api.api_audit_log;
DROP TABLE permission_api.project_collection_map;
DROP TABLE permission_api.service_clients;
