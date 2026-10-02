import type { Middleware } from "koa";
import { getServiceClient } from "./service-key-authentication-middleware.ts";

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

const DEFAULT_OPTIONS: RateLimitOptions = { windowMs: 60_000, maxRequests: 120 };

interface Bucket {
  count: number;
  windowStartedAt: number;
}

/**
 * Giới hạn request theo service key, giữ trong bộ nhớ tiến trình (đúng khi
 * chạy 1 instance — xem phase-04, mục Risk Assessment). Chạy SAU middleware
 * xác thực key vì cần `ctx.state.serviceClient`.
 */
export function createInMemoryRateLimitMiddleware(
  options: Partial<RateLimitOptions> = {},
): Middleware {
  const { windowMs, maxRequests } = { ...DEFAULT_OPTIONS, ...options };
  const buckets = new Map<string, Bucket>();

  return async (ctx, next) => {
    const client = getServiceClient(ctx.state);
    const now = Date.now();
    let bucket = buckets.get(client.id);
    if (!bucket || now - bucket.windowStartedAt >= windowMs) {
      bucket = { count: 0, windowStartedAt: now };
      buckets.set(client.id, bucket);
    }
    bucket.count += 1;

    if (bucket.count > maxRequests) {
      const retryAfterSeconds = Math.max(
        Math.ceil((bucket.windowStartedAt + windowMs - now) / 1000),
        1,
      );
      ctx.set("Retry-After", String(retryAfterSeconds));
      ctx.status = 429;
      ctx.body = {
        error: { code: "RATE_LIMITED", message: "Too many requests for this service key." },
        requestId: String(ctx.state.requestId ?? ""),
      };
      return;
    }
    await next();
  };
}
