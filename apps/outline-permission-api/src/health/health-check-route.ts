import type { Middleware } from "koa";
import type pg from "pg";

/**
 * GET /healthz: 200 khi service nối được Postgres (thứ duy nhất nó phụ thuộc
 * ngoài Outline), 503 khi không. Dùng cho healthcheck của compose.
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
