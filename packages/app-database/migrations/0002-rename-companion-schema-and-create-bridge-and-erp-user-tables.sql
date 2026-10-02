-- Up Migration
-- Cần role bridge_app và permission_api_app có sẵn (infra/postgres-init, hoặc
-- SQL chạy tay trong infra/README.md). Thiếu role thì GRANT lỗi và cả migration
-- rollback.

-- Không còn app companion: schema (đang rỗng) thuộc về permission API.
ALTER SCHEMA companion RENAME TO permission_api;

-- ───────────── bridge ─────────────

-- Lưu trữ của oidc-provider: session, interaction, grant, code, access token.
CREATE TABLE bridge.oidc_payloads (
  model       text        NOT NULL,
  id          text        NOT NULL,
  payload     jsonb       NOT NULL,
  grant_id    text,
  user_code   text,
  uid         text,
  expires_at  timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY (model, id)
);
CREATE INDEX oidc_payloads_grant_id_idx ON bridge.oidc_payloads (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX oidc_payloads_uid_idx ON bridge.oidc_payloads (uid) WHERE uid IS NOT NULL;
CREATE INDEX oidc_payloads_expires_at_idx ON bridge.oidc_payloads (expires_at);

-- 1 dòng cho 1 JWT handoff của ERP. `jti` chống replay; `handoff_id` (giá trị
-- cookie) chờ được dùng đúng 1 lần ở /interaction.
CREATE TABLE bridge.sso_handoffs (
  jti                text        PRIMARY KEY,
  handoff_id         text        NOT NULL UNIQUE,
  erp_user_id        text        NOT NULL,
  token_expires_at   timestamptz NOT NULL,
  handoff_expires_at timestamptz NOT NULL,
  consumed_at        timestamptz,
  ip                 text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sso_handoffs_token_expires_at_idx ON bridge.sso_handoffs (token_expires_at);

-- Lần đăng nhập SAI của form system_admin (đúng thì xóa các dòng cùng username + ip).
CREATE TABLE bridge.login_attempts (
  id           bigserial   PRIMARY KEY,
  username     text        NOT NULL,
  ip           text        NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_username_ip_idx ON bridge.login_attempts (username, ip, attempted_at);
CREATE INDEX login_attempts_ip_idx ON bridge.login_attempts (ip, attempted_at);

-- Chỉ thêm, không sửa/xóa: bridge_app không có quyền UPDATE/DELETE trên bảng này.
CREATE TABLE bridge.auth_audit_log (
  id          bigserial   PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event       text        NOT NULL,
  outcome     text        NOT NULL,
  subject     text,
  ip          text,
  user_agent  text,
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX auth_audit_log_occurred_at_idx ON bridge.auth_audit_log (occurred_at);

-- ───────────── permission_api ─────────────

-- Hồ sơ user ERP. Ghi bởi API provision (phase 4); bridge chỉ đọc. Email là
-- danh tính Outline dùng để khớp account → unique không phân biệt hoa thường.
CREATE TABLE permission_api.erp_users (
  erp_user_id     text        PRIMARY KEY,
  email           text        NOT NULL,
  display_name    text        NOT NULL,
  outline_user_id uuid,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX erp_users_email_lower_key ON permission_api.erp_users (lower(email));

-- ───────────── quyền theo service ─────────────

GRANT USAGE ON SCHEMA bridge TO bridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bridge.oidc_payloads, bridge.sso_handoffs, bridge.login_attempts TO bridge_app;
GRANT SELECT, INSERT ON bridge.auth_audit_log TO bridge_app;
GRANT USAGE ON SEQUENCE bridge.login_attempts_id_seq, bridge.auth_audit_log_id_seq TO bridge_app;

GRANT USAGE ON SCHEMA permission_api TO bridge_app, permission_api_app;
GRANT SELECT ON permission_api.erp_users TO bridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON permission_api.erp_users TO permission_api_app;

-- Down Migration
DROP TABLE permission_api.erp_users;
DROP TABLE bridge.auth_audit_log;
DROP TABLE bridge.login_attempts;
DROP TABLE bridge.sso_handoffs;
DROP TABLE bridge.oidc_payloads;
REVOKE USAGE ON SCHEMA permission_api FROM bridge_app, permission_api_app;
REVOKE USAGE ON SCHEMA bridge FROM bridge_app;
ALTER SCHEMA permission_api RENAME TO companion;
