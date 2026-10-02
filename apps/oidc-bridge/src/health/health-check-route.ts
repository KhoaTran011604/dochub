import type { Middleware } from "koa";
import type pg from "pg";

/**
 * GET /healthz: 200 khi bridge nối được Postgres (thứ duy nhất nó phụ thuộc),
 * 503 khi không. Dùng cho healthcheck của compose / reverse proxy.
 */
export function createHealthCheckRoute(pool: pg.Pool): Middleware {
  return async (ctx) => {
    ctx.set("Cache-Control", "no-store");
    try {
      await pool.query("SELECT 1");
      ctx.body = { status: "ok" };
    } catch {
      ctx.status = 503;
      ctx.body = { status: "database_unavailable" };
    }
  };
}
