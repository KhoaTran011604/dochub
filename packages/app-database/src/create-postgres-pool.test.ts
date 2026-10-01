import { afterEach, describe, expect, it, vi } from "vitest";
import { createPostgresPool } from "./create-postgres-pool.ts";

describe("createPostgresPool", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when no URL is passed and APP_DATABASE_URL is unset", () => {
    vi.stubEnv("APP_DATABASE_URL", "");
    expect(() => createPostgresPool()).toThrow("APP_DATABASE_URL is not set");
  });

  it("builds a pool from the given URL without connecting", async () => {
    const pool = createPostgresPool(
      "postgres://app:secret@db.internal:5433/hd_document_apps",
    );
    try {
      expect(pool.options.connectionString).toBe(
        "postgres://app:secret@db.internal:5433/hd_document_apps",
      );
      expect(pool.totalCount).toBe(0);
      expect(pool.listenerCount("error")).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("falls back to APP_DATABASE_URL", async () => {
    vi.stubEnv(
      "APP_DATABASE_URL",
      "postgres://app:secret@localhost:5432/from_env",
    );
    const pool = createPostgresPool();
    try {
      expect(pool.options.connectionString).toBe(
        "postgres://app:secret@localhost:5432/from_env",
      );
    } finally {
      await pool.end();
    }
  });
});
