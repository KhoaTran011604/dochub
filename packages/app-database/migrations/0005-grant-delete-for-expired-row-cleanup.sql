-- Up Migration
-- Job dọn rác định kỳ của permission-api xóa dòng hết hạn ở 2 bảng này, và
-- xóa dòng idempotency khi validate thất bại để retry cùng key không bị 409.
GRANT DELETE ON permission_api.pending_document_requests TO permission_api_app;
GRANT DELETE ON permission_api.idempotency_keys TO permission_api_app;

-- Down Migration
REVOKE DELETE ON permission_api.idempotency_keys FROM permission_api_app;
REVOKE DELETE ON permission_api.pending_document_requests FROM permission_api_app;
