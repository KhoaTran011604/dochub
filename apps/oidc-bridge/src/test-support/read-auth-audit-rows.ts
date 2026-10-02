import type pg from "pg";

export interface AuditOutcome {
  outcome: string;
  reason: string | null;
}

/** Các dòng audit mang `jti` này, theo thứ tự ghi. */
export async function auditOutcomesFor(
  ownerPool: pg.Pool,
  jti: string,
): Promise<AuditOutcome[]> {
  const result = await ownerPool.query<AuditOutcome>(
    `SELECT outcome, detail->>'reason' AS reason FROM bridge.auth_audit_log
     WHERE detail->>'jti' = $1 ORDER BY id`,
    [jti],
  );
  return result.rows;
}
