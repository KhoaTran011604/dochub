-- Up Migration
-- Mỗi app tự viết có 1 schema riêng trong database hd_document_apps.
CREATE SCHEMA IF NOT EXISTS bridge;
CREATE SCHEMA IF NOT EXISTS companion;

-- Down Migration
DROP SCHEMA IF EXISTS companion;
DROP SCHEMA IF EXISTS bridge;
