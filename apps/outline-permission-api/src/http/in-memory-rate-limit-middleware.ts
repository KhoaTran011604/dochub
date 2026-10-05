import type { Context, Middleware } from "koa";
import { getServiceClient } from "./service-key-authentication-middleware.ts";

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  /** Khóa bucket; mặc định = id service client (route đã xác thực). Route công khai dùng IP. */
  keyOf?: (ctx: Context) => string;
}

const DEFAULT_OPTIONS = { windowMs: 60_000, maxRequests: 120 };

/** Quá ngưỡng này thì quét bỏ bucket hết hạn (khóa theo IP có thể tăng vô hạn). */
const MAX_BUCKETS = 10_000;

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
  const keyOf = options.keyOf ?? ((ctx: Context) => getServiceClient(ctx.state).id);
  const buckets = new Map<string, Bucket>();

  return async (ctx, next) => {
    const key = keyOf(ctx);
    const now = Date.now();
    if (buckets.size >= MAX_BUCKETS) {
      for (const [bucketKey, old] of buckets) if (now - old.windowStartedAt >= windowMs) buckets.delete(bucketKey);
    }
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStartedAt >= windowMs) {
      bucket = { count: 0, windowStartedAt: now };
      buckets.set(key, bucket);
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
        error: { code: "RATE_LIMITED", message: "Too many requests." },
        requestId: String(ctx.state.requestId ?? ""),
      };
      return;
    }
    await next();
  };
}
