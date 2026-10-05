import type pg from "pg";
import type { TokenSealer } from "./seal-and-unseal-token.ts";

/** Token ở dạng thô: chỉ tồn tại trong bộ nhớ, DB chỉ chứa bản niêm phong. */
export interface UserOutlineGrant {
  erpUserId: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  scope: string;
}

interface GrantRow {
  erp_user_id: string;
  sealed_refresh_token: string;
  sealed_access_token: string;
  access_token_expires_at: Date;
  scope: string;
}

/** Thao tác trên dòng grant đang bị khóa (`FOR UPDATE`) trong 1 transaction. */
export interface LockedGrantHandle {
  save(grant: UserOutlineGrant): Promise<void>;
  remove(): Promise<void>;
}

export interface UserOutlineGrantRepository {
  upsert(grant: UserOutlineGrant): Promise<void>;
  /** Xóa và trả grant đã xóa (để caller thu hồi token phía Outline). */
  delete(erpUserId: string): Promise<UserOutlineGrant | undefined>;
  /**
   * Chạy `work` trong transaction giữ khóa hàng của grant: request thứ 2 cùng
   * user chờ ở đây tới khi request 1 commit (refresh token xoay mỗi lần dùng).
   * `grant` = undefined khi user chưa có grant (không có gì để khóa).
   */
  withLockedGrant<T>(
    erpUserId: string,
    work: (grant: UserOutlineGrant | undefined, handle: LockedGrantHandle) => Promise<T>,
  ): Promise<T>;
}

const SELECT_COLUMNS =
  "erp_user_id, sealed_refresh_token, sealed_access_token, access_token_expires_at, scope";

export function createUserOutlineGrantRepository(
  pool: pg.Pool,
  sealer: TokenSealer,
): UserOutlineGrantRepository {
  async function fromRow(row: GrantRow): Promise<UserOutlineGrant> {
    return {
      erpUserId: row.erp_user_id,
      refreshToken: await sealer.unseal(row.sealed_refresh_token),
      accessToken: await sealer.unseal(row.sealed_access_token),
      accessTokenExpiresAt: row.access_token_expires_at,
      scope: row.scope,
    };
  }

  async function upsertWith(db: pg.Pool | pg.PoolClient, grant: UserOutlineGrant): Promise<void> {
    await db.query(
      `INSERT INTO permission_api.user_outline_grants
         (erp_user_id, sealed_refresh_token, sealed_access_token, access_token_expires_at, scope)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (erp_user_id) DO UPDATE SET
         sealed_refresh_token = EXCLUDED.sealed_refresh_token,
         sealed_access_token = EXCLUDED.sealed_access_token,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         scope = EXCLUDED.scope,
         updated_at = now()`,
      [
        grant.erpUserId,
        await sealer.seal(grant.refreshToken),
        await sealer.seal(grant.accessToken),
        grant.accessTokenExpiresAt,
        grant.scope,
      ],
    );
  }

  return {
    upsert: (grant) => upsertWith(pool, grant),

    async delete(erpUserId) {
      const result = await pool.query<GrantRow>(
        `DELETE FROM permission_api.user_outline_grants WHERE erp_user_id = $1 RETURNING ${SELECT_COLUMNS}`,
        [erpUserId],
      );
      const row = result.rows[0];
      return row ? fromRow(row) : undefined;
    },

    async withLockedGrant(erpUserId, work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<GrantRow>(
          `SELECT ${SELECT_COLUMNS} FROM permission_api.user_outline_grants WHERE erp_user_id = $1 FOR UPDATE`,
          [erpUserId],
        );
        const row = result.rows[0];
        const handle: LockedGrantHandle = {
          save: (grant) => upsertWith(client, grant),
          async remove() {
            await client.query("DELETE FROM permission_api.user_outline_grants WHERE erp_user_id = $1", [erpUserId]);
          },
        };
        // Khóa niêm phong đổi / dữ liệu hỏng: coi như chưa có grant, user đồng ý lại.
        const grant = row ? await fromRow(row).catch(() => undefined) : undefined;
        if (row && !grant) await handle.remove();
        const value = await work(grant, handle);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
