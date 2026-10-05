-- Up Migration
-- Bảng cho API tạo node với tác giả là user thật (phase 5).

-- Grant OAuth của Outline theo user ERP. Token luôn lưu NIÊM PHONG
-- (iron-webcrypto, khóa TOKEN_SEAL_PASSWORD), không bao giờ ở dạng thô.
-- Xóa user ERP thì xóa luôn grant.
CREATE TABLE permission_api.user_outline_grants (
  erp_user_id             text        PRIMARY KEY REFERENCES permission_api.erp_users (erp_user_id) ON DELETE CASCADE,
  sealed_refresh_token    text        NOT NULL,
  sealed_access_token     text        NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  scope                   text        NOT NULL,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Yêu cầu tạo doc chờ user bấm Đồng ý. `id` là requestId ngẫu nhiên 128 bit
-- (pendingUrl). `oauth_state` dùng 1 lần (NULL sau khi callback nhận);
-- `oauth_code_verifier` là PKCE verifier tương ứng.
CREATE TABLE permission_api.pending_document_requests (
  id                  text        PRIMARY KEY,
  service_client_id   text        NOT NULL,
  idempotency_key     text        NOT NULL,
  erp_user_id         text        NOT NULL REFERENCES permission_api.erp_users (erp_user_id) ON DELETE CASCADE,
  payload             jsonb       NOT NULL,
  oauth_state         text        UNIQUE,
  oauth_code_verifier text,
  status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  document_id         uuid        NOT NULL,
  document_url        text,
  expires_at          timestamptz NOT NULL,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_client_id, idempotency_key)
);
CREATE INDEX pending_document_requests_expires_at_idx ON permission_api.pending_document_requests (expires_at);

-- 1 dòng cho 1 Idempotency-Key của 1 service client. `document_id` sinh trước
-- khi gọi Outline; `response_*` NULL = chưa có kết quả cuối (đang xử lý / sập giữa chừng).
CREATE TABLE permission_api.idempotency_keys (
  service_client_id text        NOT NULL,
  key               text        NOT NULL,
  request_hash      text        NOT NULL,
  document_id       uuid        NOT NULL,
  response_status   integer,
  response_body     jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_client_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON permission_api.user_outline_grants TO permission_api_app;
GRANT SELECT, INSERT, UPDATE ON permission_api.pending_document_requests TO permission_api_app;
GRANT SELECT, INSERT, UPDATE ON permission_api.idempotency_keys TO permission_api_app;

-- Down Migration
REVOKE SELECT, INSERT, UPDATE ON permission_api.idempotency_keys FROM permission_api_app;
REVOKE SELECT, INSERT, UPDATE ON permission_api.pending_document_requests FROM permission_api_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON permission_api.user_outline_grants FROM permission_api_app;
DROP TABLE permission_api.idempotency_keys;
DROP TABLE permission_api.pending_document_requests;
DROP TABLE permission_api.user_outline_grants;
