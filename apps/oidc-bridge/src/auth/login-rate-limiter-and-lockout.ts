import type pg from "pg";

/** Số lần sai liên tiếp của 1 cặp (username, IP) trước khi khóa. */
export const FAILURES_PER_LOCKOUT = 5;
const BASE_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOCKOUT_MS = 8 * 60 * 60 * 1000;
/** Chỉ đếm lần sai trong khoảng này; cũng là thời hạn giữ dòng trong bảng. */
export const FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;

/** Trần theo IP (mọi username): chặn dò nhiều username từ 1 máy. */
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_FAILURES = 20;

/**
 * Khóa tăng dần cho 1 cặp (username, IP): lần sai thứ 5 → khóa 15 phút, thứ 10
 * → 30 phút, thứ 15 → 1 giờ... tối đa 8 giờ. Hết khóa được thử tiếp 4 lần trước
 * lần khóa kế. Đăng nhập đúng xóa bộ đếm. Lần thử trong lúc khóa không được ghi
 * nên không kéo dài khóa.
 * Trả thời điểm hết khóa, hoặc undefined nếu không khóa.
 */
export function computeLockedUntil(
  failureTimes: readonly Date[],
  now: Date,
): Date | undefined {
  const recent = failureTimes.filter(
    (time) => now.getTime() - time.getTime() < FAILURE_MEMORY_MS,
  );
  if (recent.length === 0 || recent.length % FAILURES_PER_LOCKOUT !== 0)
    return undefined;

  const lockouts = recent.length / FAILURES_PER_LOCKOUT;
  const lastFailure = Math.max(...recent.map((time) => time.getTime()));
  const duration = Math.min(
    BASE_LOCKOUT_MS * 2 ** (lockouts - 1),
    MAX_LOCKOUT_MS,
  );
  const lockedUntil = new Date(lastFailure + duration);
  return lockedUntil > now ? lockedUntil : undefined;
}

export interface LoginRateLimiter {
  /** true = từ chối luôn, không kiểm mật khẩu. */
  isBlocked(username: string, ip: string): Promise<boolean>;
  recordFailure(username: string, ip: string): Promise<void>;
  recordSuccess(username: string, ip: string): Promise<void>;
}

/**
 * Khóa theo (username, IP) chứ không theo username: kẻ dò mật khẩu từ máy khác
 * không khóa được admin thật. `username` là chuỗi đã chuẩn hóa và cắt ngắn.
 */
export function createLoginRateLimiter(
  pool: pg.Pool,
  now: () => Date = () => new Date(),
): LoginRateLimiter {
  return {
    async isBlocked(username, ip) {
      const current = now();
      const [pair, perIp] = await Promise.all([
        pool.query<{ attempted_at: Date }>(
          `SELECT attempted_at FROM bridge.login_attempts
           WHERE username = $1 AND ip = $2 AND attempted_at > $3`,
          [username, ip, new Date(current.getTime() - FAILURE_MEMORY_MS)],
        ),
        pool.query<{ failures: string }>(
          `SELECT count(*) AS failures FROM bridge.login_attempts
           WHERE ip = $1 AND attempted_at > $2`,
          [ip, new Date(current.getTime() - IP_WINDOW_MS)],
        ),
      ]);
      if (Number(perIp.rows[0]?.failures ?? 0) >= IP_MAX_FAILURES) return true;
      return (
        computeLockedUntil(
          pair.rows.map((row) => row.attempted_at),
          current,
        ) !== undefined
      );
    },

    async recordFailure(username, ip) {
      await pool.query(
        `INSERT INTO bridge.login_attempts (username, ip, attempted_at) VALUES ($1, $2, $3)`,
        [username, ip, now()],
      );
    },

    async recordSuccess(username, ip) {
      await pool.query(
        `DELETE FROM bridge.login_attempts WHERE username = $1 AND ip = $2`,
        [username, ip],
      );
    },
  };
}
