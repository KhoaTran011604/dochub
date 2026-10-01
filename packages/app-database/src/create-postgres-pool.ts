import pg from "pg";

/**
 * Tạo pool tới database `hd_document_apps` (schema `bridge`, `companion`).
 * Không dùng cho database `outline` — database đó chỉ Outline được đụng.
 */
export function createPostgresPool(
  databaseUrl: string | undefined = process.env.APP_DATABASE_URL,
): pg.Pool {
  if (!databaseUrl) {
    throw new Error("APP_DATABASE_URL is not set");
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });

  // Client rảnh bị ngắt (Postgres restart, mạng) phát 'error' trên pool;
  // không có listener thì process chết.
  pool.on("error", (error) => {
    console.error("Postgres pool: idle client error:", error.message);
  });

  return pool;
}
