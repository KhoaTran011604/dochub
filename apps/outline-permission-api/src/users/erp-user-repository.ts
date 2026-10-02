import type pg from "pg";

export interface ErpUserRecord {
  erpUserId: string;
  email: string;
  displayName: string;
  outlineUserId: string | null;
  status: "active" | "deactivated";
}

interface ErpUserRow {
  erp_user_id: string;
  email: string;
  display_name: string;
  outline_user_id: string | null;
  status: string;
}

function toRecord(row: ErpUserRow): ErpUserRecord {
  return {
    erpUserId: row.erp_user_id,
    email: row.email,
    displayName: row.display_name,
    outlineUserId: row.outline_user_id,
    status: row.status === "deactivated" ? "deactivated" : "active",
  };
}

export class EmailAlreadyInUseError extends Error {
  constructor(email: string) {
    super(`Email "${email}" is already in use by another ERP user.`);
    this.name = "EmailAlreadyInUseError";
  }
}

const UNIQUE_VIOLATION_CODE = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === "object" &&
    "code" in (error as object) &&
    (error as { code?: string }).code === UNIQUE_VIOLATION_CODE
  );
}

export interface ErpUserRepository {
  findByErpUserId(erpUserId: string): Promise<ErpUserRecord | undefined>;
  insert(input: {
    erpUserId: string;
    email: string;
    displayName: string;
    outlineUserId: string;
  }): Promise<ErpUserRecord>;
  updateProfile(erpUserId: string, email: string, displayName: string): Promise<ErpUserRecord>;
  setStatus(erpUserId: string, status: "active" | "deactivated"): Promise<void>;
}

const SELECT_COLUMNS =
  "erp_user_id, email, display_name, outline_user_id, status";

export function createErpUserRepository(pool: pg.Pool): ErpUserRepository {
  return {
    async findByErpUserId(erpUserId) {
      const result = await pool.query<ErpUserRow>(
        `SELECT ${SELECT_COLUMNS} FROM permission_api.erp_users WHERE erp_user_id = $1`,
        [erpUserId],
      );
      const row = result.rows[0];
      return row ? toRecord(row) : undefined;
    },

    async insert(input) {
      try {
        const result = await pool.query<ErpUserRow>(
          `INSERT INTO permission_api.erp_users (erp_user_id, email, display_name, outline_user_id)
           VALUES ($1, $2, $3, $4)
           RETURNING ${SELECT_COLUMNS}`,
          [input.erpUserId, input.email, input.displayName, input.outlineUserId],
        );
        const row = result.rows[0];
        if (!row) throw new Error("insert into erp_users did not return a row");
        return toRecord(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw new EmailAlreadyInUseError(input.email);
        throw error;
      }
    },

    async updateProfile(erpUserId, email, displayName) {
      try {
        const result = await pool.query<ErpUserRow>(
          `UPDATE permission_api.erp_users SET email = $2, display_name = $3, updated_at = now()
           WHERE erp_user_id = $1
           RETURNING ${SELECT_COLUMNS}`,
          [erpUserId, email, displayName],
        );
        const row = result.rows[0];
        if (!row) throw new Error(`erp_users row not found for "${erpUserId}"`);
        return toRecord(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw new EmailAlreadyInUseError(email);
        throw error;
      }
    },

    async setStatus(erpUserId, status) {
      await pool.query(
        `UPDATE permission_api.erp_users SET status = $2, updated_at = now() WHERE erp_user_id = $1`,
        [erpUserId, status],
      );
    },
  };
}
