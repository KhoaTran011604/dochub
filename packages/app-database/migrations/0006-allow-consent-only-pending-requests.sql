-- Up Migration
-- Yêu cầu "chỉ xin đồng ý" (phase 7: 409 grantUrl của API cây tài liệu) không
-- có doc để tạo: payload và document_id để trống.
ALTER TABLE permission_api.pending_document_requests
  ALTER COLUMN payload DROP NOT NULL,
  ALTER COLUMN document_id DROP NOT NULL;

-- Down Migration
DELETE FROM permission_api.pending_document_requests WHERE payload IS NULL OR document_id IS NULL;
ALTER TABLE permission_api.pending_document_requests
  ALTER COLUMN payload SET NOT NULL,
  ALTER COLUMN document_id SET NOT NULL;
