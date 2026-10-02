import type pg from "pg";

export interface ServiceClientRecord {
  id: string;
  name: string;
  keyHash: string;
  scopes: string[];
  /** `["*"]` = mọi dự án. */
  projectKeys: string[];
  revokedAt: Date | null;
}

interface ServiceClientRow {
  id: string;
  name: string;
  key_hash: string;
  scopes: string[];
  project_keys: string[];
  revoked_at: Date | null;
}

function toRecord(row: ServiceClientRow): ServiceClientRecord {
  return {
    id: row.id,
    name: row.name,
    keyHash: row.key_hash,
    scopes: row.scopes,
    projectKeys: row.project_keys,
    revokedAt: row.revoked_at,
  };
}

export interface ServiceClientRepository {
  findActiveById(id: string): Promise<ServiceClientRecord | undefined>;
  findActiveByName(name: string): Promise<ServiceClientRecord | undefined>;
  create(input: {
    id: string;
    name: string;
    keyHash: string;
    scopes: string[];
    projectKeys: string[];
  }): Promise<void>;
  updateKeyHash(id: string, keyHash: string): Promise<void>;
  revoke(id: string): Promise<void>;
}

const SELECT_COLUMNS = "id, name, key_hash, scopes, project_keys, revoked_at";

export function createServiceClientRepository(pool: pg.Pool): ServiceClientRepository {
  return {
    async findActiveById(id) {
      const result = await pool.query<ServiceClientRow>(
        `SELECT ${SELECT_COLUMNS} FROM permission_api.service_clients
         WHERE id = $1 AND revoked_at IS NULL`,
        [id],
      );
      const row = result.rows[0];
      return row ? toRecord(row) : undefined;
    },

    async findActiveByName(name) {
      const result = await pool.query<ServiceClientRow>(
        `SELECT ${SELECT_COLUMNS} FROM permission_api.service_clients
         WHERE name = $1 AND revoked_at IS NULL`,
        [name],
      );
      const row = result.rows[0];
      return row ? toRecord(row) : undefined;
    },

    async create(input) {
      await pool.query(
        `INSERT INTO permission_api.service_clients (id, name, key_hash, scopes, project_keys)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.id, input.name, input.keyHash, input.scopes, input.projectKeys],
      );
    },

    async updateKeyHash(id, keyHash) {
      await pool.query(
        `UPDATE permission_api.service_clients SET key_hash = $2 WHERE id = $1`,
        [id, keyHash],
      );
    },

    async revoke(id) {
      await pool.query(
        `UPDATE permission_api.service_clients SET revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL`,
        [id],
      );
    },
  };
}
