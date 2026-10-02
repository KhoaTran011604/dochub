import type pg from "pg";

export type AuthAuditEvent =
  /** /sso nhận JWT của ERP. */
  | "sso_handoff"
  /** Handoff được dùng ở /interaction để đăng nhập. */
  | "sso_login"
  /** Form system_admin. */
  | "admin_login";

export interface AuthAuditEntry {
  event: AuthAuditEvent;
  outcome: "success" | "rejected";
  /** `erp:<id>`, `local:system_admin`, hoặc username đã gõ (chưa xác thực). */
  subject?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  /** Lý do, jti... KHÔNG bao giờ chứa token, mật khẩu hay cookie. */
  detail?: Record<string, string | number | boolean | undefined>;
}

export type AuthAuditLogger = (entry: AuthAuditEntry) => Promise<void>;

const MAX_TEXT_LENGTH = 300;
const truncate = (value: string | undefined) =>
  value?.slice(0, MAX_TEXT_LENGTH) ?? null;

/**
 * Ghi 1 dòng vào `bridge.auth_audit_log` và 1 dòng JSON ra stdout. Lỗi ghi DB
 * không làm hỏng request: đã có bản stdout, và đăng nhập không nên chết vì audit.
 */
export function createAuthAuditLogger(pool: pg.Pool): AuthAuditLogger {
  return async (entry) => {
    console.log(
      JSON.stringify({
        type: "auth_audit",
        at: new Date().toISOString(),
        ...entry,
      }),
    );
    try {
      await pool.query(
        `INSERT INTO bridge.auth_audit_log (event, outcome, subject, ip, user_agent, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.event,
          entry.outcome,
          truncate(entry.subject),
          truncate(entry.ip),
          truncate(entry.userAgent),
          JSON.stringify(entry.detail ?? {}),
        ],
      );
    } catch (error) {
      console.error(
        "auth audit: could not write to database:",
        error instanceof Error ? error.message : error,
      );
    }
  };
}
