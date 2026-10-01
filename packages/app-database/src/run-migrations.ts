import path from "node:path";
import { runner } from "node-pg-migrate";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "migrations");

/**
 * Chạy mọi migration chưa áp dụng. Migration đã chạy được ghi trong bảng
 * `public.pgmigrations` nên gọi lại nhiều lần không lỗi.
 * Trả về tên các migration vừa chạy.
 */
export async function runMigrations(
  databaseUrl: string | undefined = process.env.APP_DATABASE_URL,
): Promise<string[]> {
  if (!databaseUrl) {
    throw new Error("APP_DATABASE_URL is not set");
  }

  const applied = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: "up",
    migrationsTable: "pgmigrations",
    log: () => {},
  });

  return applied.map((migration) => migration.name);
}
