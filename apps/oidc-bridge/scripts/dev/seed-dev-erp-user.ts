// DEV: ghi 1 user ERP vào permission_api.erp_users (thay cho API provision của
// phase 4). Chạy bằng role owner qua APP_DATABASE_URL.
//   pnpm --filter @hd-document/oidc-bridge dev:seed-erp-user --erp-user-id u-001 \
//     --email an@example.com --name "Nguyễn An" [--status deactivated]
import { parseArgs } from "node:util";
import { createPostgresPool } from "@hd-document/app-database";
import { refuseToRunInProduction } from "./dev-erp-signing-key-file.ts";

refuseToRunInProduction("seed-dev-erp-user");

const { values } = parseArgs({
  options: {
    "erp-user-id": { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    status: { type: "string", default: "active" },
  },
});

const erpUserId = values["erp-user-id"];
const { email, name, status } = values;
if (
  !erpUserId ||
  !email ||
  !name ||
  !["active", "deactivated"].includes(status)
) {
  console.error(
    "Usage: seed-dev-erp-user --erp-user-id <id> --email <email> --name <name> [--status active|deactivated]",
  );
  process.exit(1);
}

const pool = createPostgresPool();
try {
  await pool.query(
    `INSERT INTO permission_api.erp_users (erp_user_id, email, display_name, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (erp_user_id) DO UPDATE SET
       email = EXCLUDED.email, display_name = EXCLUDED.display_name,
       status = EXCLUDED.status, updated_at = now()`,
    [erpUserId, email, name, status],
  );
  console.log(`Seeded ERP user ${erpUserId} (${status}).`);
} catch (error) {
  // Chỉ in message: lỗi kết nối của pg có thể kèm connection string.
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
