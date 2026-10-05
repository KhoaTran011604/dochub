import pg from "pg";
import { loadEnvironmentConfig } from "./config/environment-config.ts";
import { createPermissionApiApplication } from "./create-permission-api-application.ts";

const config = loadEnvironmentConfig();

const pool = new pg.Pool({ connectionString: config.PERMISSION_API_DATABASE_URL });
// Client rảnh bị ngắt (Postgres restart) phát 'error' trên pool; không có
// listener thì process chết.
pool.on("error", (error) => {
  console.error("Postgres pool: idle client error:", error.message);
});

const app = createPermissionApiApplication(config, pool);

const server = app.listen(config.PORT, () => {
  console.log(`outline-permission-api listening on :${config.PORT}`);
});

const stopBackgroundJobs = app.startBackgroundJobs();

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopBackgroundJobs();
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  // Kết nối keep-alive treo thì không chờ mãi.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
