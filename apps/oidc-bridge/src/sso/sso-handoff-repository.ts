import { randomBytes } from "node:crypto";
import type pg from "pg";

/** Thời gian từ /sso tới lúc trình duyệt quay lại /interaction. */
export const HANDOFF_LIFETIME_SECONDS = 120;

const POSTGRES_UNIQUE_VIOLATION = "23505";

export interface NewSsoHandoff {
  jti: string;
  erpUserId: string;
  tokenExpiresAt: Date;
  ip: string | undefined;
}

export type CreateHandoffResult =
  { created: true; handoffId: string } | { created: false };

export interface SsoHandoffRepository {
  /** `created: false` = `jti` đã thấy trước đó (replay). */
  create(handoff: NewSsoHandoff): Promise<CreateHandoffResult>;
  /** Dùng handoff đúng 1 lần. Trả erpUserId, hoặc undefined nếu lạ/hết hạn/đã dùng. */
  consume(handoffId: string): Promise<string | undefined>;
}

/**
 * 1 bảng cho cả chống replay (`jti` là khóa chính) lẫn trạng thái chờ đăng nhập
 * (`handoff_id` ngẫu nhiên nằm trong cookie, không mang danh tính).
 */
export function createSsoHandoffRepository(
  pool: pg.Pool,
): SsoHandoffRepository {
  return {
    async create(handoff) {
      const handoffId = randomBytes(32).toString("base64url");
      try {
        await pool.query(
          `INSERT INTO bridge.sso_handoffs
             (jti, handoff_id, erp_user_id, token_expires_at, handoff_expires_at, ip)
           VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), $6)`,
          [
            handoff.jti,
            handoffId,
            handoff.erpUserId,
            handoff.tokenExpiresAt,
            HANDOFF_LIFETIME_SECONDS,
            handoff.ip ?? null,
          ],
        );
        return { created: true, handoffId };
      } catch (error) {
        if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
          return { created: false };
        }
        throw error;
      }
    },

    async consume(handoffId) {
      // 1 câu UPDATE có điều kiện: 2 request song song chỉ 1 cái thắng.
      const result = await pool.query<{ erp_user_id: string }>(
        `UPDATE bridge.sso_handoffs SET consumed_at = now()
         WHERE handoff_id = $1 AND consumed_at IS NULL AND handoff_expires_at > now()
         RETURNING erp_user_id`,
        [handoffId],
      );
      return result.rows[0]?.erp_user_id;
    },
  };
}
