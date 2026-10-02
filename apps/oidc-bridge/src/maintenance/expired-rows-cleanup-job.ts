import type pg from "pg";
import { FAILURE_MEMORY_MS } from "../auth/login-rate-limiter-and-lockout.ts";

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

/** Xóa dòng đã hết hạn. Bảng audit không dọn ở đây (giữ theo chính sách vận hành). */
export async function deleteExpiredRows(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM bridge.oidc_payloads WHERE expires_at < now()`);
  // Giữ `jti` tới khi token chắc chắn không còn verify được (hạn + lệch đồng hồ).
  await pool.query(
    `DELETE FROM bridge.sso_handoffs
     WHERE token_expires_at < now() - interval '5 minutes' AND handoff_expires_at < now()`,
  );
  await pool.query(
    `DELETE FROM bridge.login_attempts WHERE attempted_at < $1`,
    [new Date(Date.now() - FAILURE_MEMORY_MS)],
  );
}

/** Chạy dọn định kỳ trong process bridge. Trả hàm dừng. */
export function startExpiredRowsCleanupJob(pool: pg.Pool): () => void {
  const run = () => {
    deleteExpiredRows(pool).catch((error: unknown) => {
      console.error(
        "cleanup job failed:",
        error instanceof Error ? error.message : error,
      );
    });
  };
  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
