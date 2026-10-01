-- Chạy 1 lần khi volume postgres còn trống (docker-entrypoint-initdb.d).
-- Mật khẩu lấy từ env của container postgres; thiếu biến thì lệnh CREATE ROLE
-- lỗi cú pháp và init dừng (entrypoint chạy psql với ON_ERROR_STOP=1).
\getenv outline_db_password OUTLINE_DB_PASSWORD
\getenv app_db_password APP_DB_PASSWORD

CREATE ROLE outline LOGIN PASSWORD :'outline_db_password';
CREATE ROLE hd_document_apps LOGIN PASSWORD :'app_db_password';

CREATE DATABASE outline OWNER outline;
CREATE DATABASE hd_document_apps OWNER hd_document_apps;

-- Mặc định mọi role đều CONNECT được mọi database. Thu lại để role của app
-- không vào được database của Outline và ngược lại (owner vẫn giữ quyền).
-- Database `postgres` mặc định: chỉ superuser cần vào.
REVOKE CONNECT ON DATABASE outline FROM PUBLIC;
REVOKE CONNECT ON DATABASE hd_document_apps FROM PUBLIC;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
