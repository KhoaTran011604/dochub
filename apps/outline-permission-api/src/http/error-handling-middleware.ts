import { OutlineApiError, OutlineOAuthError, OutlineRateLimitedError } from "@hd-document/outline-api-client";
import type { Middleware } from "koa";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { ApiError } from "./api-error.ts";

interface ErrorBody {
  code: string;
  message: string;
}

function toErrorBody(error: unknown): { status: number; body: ErrorBody; retryAfterSeconds?: number } {
  if (error instanceof ApiError) {
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
  if (error instanceof ZodError) {
    const detail = error.issues.map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`).join("; ");
    return { status: 400, body: { code: "VALIDATION_ERROR", message: detail } };
  }
  if (error instanceof OutlineRateLimitedError) {
    return {
      status: 429,
      body: { code: "OUTLINE_RATE_LIMITED", message: "Outline API rate limit exceeded; retry later." },
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  if (error instanceof OutlineOAuthError) {
    if (error.status === 429) {
      return { status: 429, body: { code: "OUTLINE_RATE_LIMITED", message: "Outline OAuth rate limit exceeded; retry later." }, retryAfterSeconds: 60 };
    }
    return { status: 502, body: { code: "OUTLINE_ERROR", message: "Outline OAuth call failed." } };
  }
  if (error instanceof OutlineApiError) {
    // Lỗi của Outline (4xx/5xx không map riêng ở trên) → 502, an toàn cho ERP gọi lại.
    return { status: 502, body: { code: "OUTLINE_ERROR", message: "Outline API call failed." } };
  }
  return { status: 500, body: { code: "INTERNAL_ERROR", message: "Internal server error." } };
}

/**
 * Bắt mọi lỗi ném ra từ route/service, gán request id, không bao giờ lộ chi
 * tiết nội bộ (stack, message gốc) cho lỗi 500/502 ra ngoài response.
 */
export function createErrorHandlingMiddleware(): Middleware {
  return async (ctx, next) => {
    const requestId = ctx.get("x-request-id") || randomUUID();
    ctx.state.requestId = requestId;
    ctx.set("x-request-id", requestId);
    try {
      await next();
    } catch (error) {
      const { status, body, retryAfterSeconds } = toErrorBody(error);
      if (status >= 500) {
        console.error(`[${requestId}] ${ctx.method} ${ctx.path} failed:`, error);
      }
      if (retryAfterSeconds !== undefined) {
        ctx.set("Retry-After", String(Math.ceil(retryAfterSeconds)));
      }
      ctx.status = status;
      ctx.body = { error: body, requestId };
    }
  };
}
