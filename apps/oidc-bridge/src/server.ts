import pg from "pg";
import { loadEnvironmentConfig } from "./config/environment-config.ts";
import { createBridgeApplication } from "./create-bridge-application.ts";
import { startExpiredRowsCleanupJob } from "./maintenance/expired-rows-cleanup-job.ts";

const config = loadEnvironmentConfig();

const pool = new pg.Pool({ connectionString: config.BRIDGE_DATABASE_URL });
// Client rảnh bị ngắt (Postgres restart) phát 'error' trên pool; không có
// listener thì process chết.
pool.on("error", (error) => {
  console.error("Postgres pool: idle client error:", error.message);
});

const application = await createBridgeApplication(config, pool);
const stopCleanupJob = startExpiredRowsCleanupJob(pool);

const server = application.listen(config.PORT, () => {
  console.log(
    `oidc-bridge listening on :${config.PORT} (issuer ${config.BRIDGE_PUBLIC_URL})`,
  );
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopCleanupJob();
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  // Kết nối keep-alive treo thì không chờ mãi.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
