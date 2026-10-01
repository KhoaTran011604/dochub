// runMigrations cố ý không export ở đây: nó kéo node-pg-migrate và đọc thư mục
// migrations từ đĩa, không dùng được khi bị bundle (Next.js). Import riêng qua
// "@hd-document/app-database/run-migrations".
export { createPostgresPool } from "./create-postgres-pool.ts";
