import { afterAll, describe, expect, it, vi } from "vitest";
import { createPostgresPool } from "./create-postgres-pool.ts";
import { runMigrations } from "./run-migrations.ts";

const databaseUrl = process.env.APP_DATABASE_URL;

describe("runMigrations (no database)", () => {
  it("throws when APP_DATABASE_URL is unset", async () => {
    vi.stubEnv("APP_DATABASE_URL", "");
    try {
      await expect(runMigrations()).rejects.toThrow(
        "APP_DATABASE_URL is not set",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// Cần Postgres thật: đặt APP_DATABASE_URL (CI có service postgres; local xem infra/README.md).
describe.skipIf(!databaseUrl)("runMigrations (real Postgres)", () => {
  const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

  afterAll(async () => {
    await pool?.end();
  });

  it("creates the bridge and companion schemas", async () => {
    await runMigrations(databaseUrl);

    const result = await pool!.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name IN ('bridge', 'companion') ORDER BY schema_name`,
    );
    expect(result.rows.map((row) => row.schema_name)).toEqual([
      "bridge",
      "companion",
    ]);
  });

  it("is idempotent: a second run applies nothing", async () => {
    await runMigrations(databaseUrl);
    await expect(runMigrations(databaseUrl)).resolves.toEqual([]);
  });
});
