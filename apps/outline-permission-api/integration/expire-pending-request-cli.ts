// DEV/E2E: ép 1 pending request hết hạn ngay (TTL thật là 7 ngày) để test nhánh 410.
// Chạy bằng role owner qua APP_DATABASE_URL; chỉ dùng trong test, không có trong image.
//   node --import tsx integration/expire-pending-request-cli.ts <requestId>
import pg from "pg";

const [requestId] = process.argv.slice(2);
const databaseUrl = process.env.APP_DATABASE_URL;
if (!requestId || !databaseUrl || process.env.NODE_ENV === "production") {
  console.error("Usage: APP_DATABASE_URL=... expire-pending-request-cli <requestId> (not for production)");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const result = await pool.query(
    `UPDATE permission_api.pending_document_requests
        SET expires_at = now() - interval '1 minute'
      WHERE id = $1`,
    [requestId],
  );
  console.log(`expired ${result.rowCount} request(s)`);
  if (result.rowCount !== 1) process.exitCode = 1;
} catch (error) {
  // Chỉ in message: lỗi kết nối của pg có thể kèm connection string.
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
