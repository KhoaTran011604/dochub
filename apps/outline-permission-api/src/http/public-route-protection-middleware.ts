import type { Middleware } from "koa";
import { createInMemoryRateLimitMiddleware } from "./in-memory-rate-limit-middleware.ts";

/**
 * Dòng log truy cập cho route công khai (trình duyệt). Chỉ ghi route pattern
 * (`/pending/:id`, KHÔNG phải path thật vì chứa requestId bí mật), IP, status;
 * không ghi query/cookie/token.
 */
export function createPublicRouteAccessLogMiddleware(log: (line: string) => void = console.log): Middleware {
  return async (ctx, next) => {
    const entry = () => ({
      type: "public_route_access",
      at: new Date().toISOString(),
      method: ctx.method,
      route: ctx.routerPath ?? "unknown",
      status: ctx.status,
      ip: ctx.ip,
      requestId: String(ctx.state.requestId ?? ""),
    });
    try {
      await next();
    } finally {
      log(JSON.stringify(entry()));
    }
  };
}

/** Log truy cập + rate limit theo IP cho route công khai (đứng trước auth/audit/rate limit của service). */
export function createPublicRouteProtectionMiddlewares(
  options: { windowMs?: number; maxRequests?: number; log?: (line: string) => void } = {},
): Middleware[] {
  const { log, ...limit } = options;
  return [
    createPublicRouteAccessLogMiddleware(log),
    createInMemoryRateLimitMiddleware({ windowMs: 60_000, maxRequests: 30, ...limit, keyOf: (ctx) => ctx.ip }),
  ];
}
