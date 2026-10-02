import type { Middleware } from "koa";
import type pg from "pg";

export interface ApiAuditEntry {
  serviceClientId: string | undefined;
  action: string;
  target?: string | undefined;
  outcome: "success" | "rejected" | "error";
  requestId: string;
  detail?: Record<string, string | number | boolean | undefined>;
}

export type ApiAuditLogger = (entry: ApiAuditEntry) => Promise<void>;

const MAX_TEXT_LENGTH = 300;
const truncate = (value: string | undefined) => value?.slice(0, MAX_TEXT_LENGTH) ?? null;

/**
 * Ghi 1 dòng vào `permission_api.api_audit_log` và 1 dòng JSON ra stdout. Lỗi
 * ghi DB không làm hỏng request: đã có bản stdout.
 */
export function createApiAuditLogger(pool: pg.Pool): ApiAuditLogger {
  return async (entry) => {
    console.log(JSON.stringify({ type: "api_audit", at: new Date().toISOString(), ...entry }));
    try {
      await pool.query(
        `INSERT INTO permission_api.api_audit_log (service_client_id, action, target, outcome, request_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.serviceClientId ?? null,
          entry.action,
          truncate(entry.target),
          entry.outcome,
          entry.requestId,
          JSON.stringify(entry.detail ?? {}),
        ],
      );
    } catch (error) {
      console.error("api audit: could not write to database:", error instanceof Error ? error.message : error);
    }
  };
}

/**
 * Ghi audit cho MỌI request đã qua xác thực key: 1 dòng / request, dù thành
 * công hay lỗi. Chạy sau middleware auth (cần `ctx.state.serviceClient`) và
 * trước router, để `ctx.routerPath` đã được @koa/router gán khi middleware
 * tiếp tục chạy sau `next()`.
 */
export function createApiAuditMiddleware(logger: ApiAuditLogger): Middleware {
  return async (ctx, next) => {
    const serviceClient = ctx.state.serviceClient as { id: string } | undefined;
    const params = (ctx.params ?? {}) as Record<string, unknown>;
    const target = Object.values(params).find((value): value is string => typeof value === "string");

    try {
      await next();
      await logger({
        serviceClientId: serviceClient?.id,
        action: `${ctx.method} ${ctx.routerPath ?? ctx.path}`,
        target,
        outcome: ctx.status < 400 ? "success" : "rejected",
        requestId: String(ctx.state.requestId ?? ""),
      });
    } catch (error) {
      await logger({
        serviceClientId: serviceClient?.id,
        action: `${ctx.method} ${ctx.routerPath ?? ctx.path}`,
        target,
        outcome: "error",
        requestId: String(ctx.state.requestId ?? ""),
        detail: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  };
}
