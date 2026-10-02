import type { Adapter, AdapterFactory, AdapterPayload } from "oidc-provider";
import type pg from "pg";

interface PayloadRow {
  payload: AdapterPayload;
  consumed_at: Date | null;
}

const NOT_EXPIRED = "(expires_at IS NULL OR expires_at > now())";

function toPayload(row: PayloadRow | undefined): AdapterPayload | undefined {
  if (!row) return undefined;
  return {
    ...row.payload,
    // Provider coi artifact đã dùng khi có `consumed` (epoch giây).
    ...(row.consumed_at
      ? { consumed: Math.floor(row.consumed_at.getTime() / 1000) }
      : undefined),
  };
}

/**
 * Lưu session, interaction, grant, code, access token của oidc-provider vào
 * `bridge.oidc_payloads` (1 bảng, khóa `model` + `id`) để restart bridge không
 * làm rớt luồng đang dở hay token Outline đang giữ.
 */
class PostgresOidcStorageAdapter implements Adapter {
  private readonly pool: pg.Pool;
  private readonly model: string;

  constructor(pool: pg.Pool, model: string) {
    this.pool = pool;
    this.model = model;
  }

  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn?: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO bridge.oidc_payloads (model, id, payload, grant_id, user_code, uid, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
       ON CONFLICT (model, id) DO UPDATE SET
         payload = EXCLUDED.payload, grant_id = EXCLUDED.grant_id,
         user_code = EXCLUDED.user_code, uid = EXCLUDED.uid, expires_at = EXCLUDED.expires_at`,
      [
        this.model,
        id,
        JSON.stringify(payload),
        payload.grantId ?? null,
        payload.userCode ?? null,
        payload.uid ?? null,
        // NULL → `now() + NULL` = NULL: không hết hạn.
        expiresIn ?? null,
      ],
    );
  }

  private async findWhere(column: "id" | "uid" | "user_code", value: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload, consumed_at FROM bridge.oidc_payloads
       WHERE model = $1 AND ${column} = $2 AND ${NOT_EXPIRED}`,
      [this.model, value],
    );
    return toPayload(result.rows[0]);
  }

  find(id: string) {
    return this.findWhere("id", id);
  }

  findByUid(uid: string) {
    return this.findWhere("uid", uid);
  }

  findByUserCode(userCode: string) {
    return this.findWhere("user_code", userCode);
  }

  async consume(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE bridge.oidc_payloads SET consumed_at = now() WHERE model = $1 AND id = $2`,
      [this.model, id],
    );
  }

  async destroy(id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM bridge.oidc_payloads WHERE model = $1 AND id = $2`,
      [this.model, id],
    );
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM bridge.oidc_payloads WHERE model = $1 AND grant_id = $2`,
      [this.model, grantId],
    );
  }
}

export function createPostgresOidcStorageAdapterFactory(
  pool: pg.Pool,
): AdapterFactory {
  return (model) => new PostgresOidcStorageAdapter(pool, model);
}
