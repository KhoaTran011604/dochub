import type pg from "pg";

export interface ErpUserProfile {
  erpUserId: string;
  email: string;
  displayName: string;
}

export type ErpUserLookup =
  | { found: true; user: ErpUserProfile }
  | {
      found: false;
      reason:
        "unknown_user" | "deactivated" | "email_reserved_for_system_admin";
    };

export type ErpUserDirectoryReader = (
  erpUserId: string,
) => Promise<ErpUserLookup>;

/**
 * Đọc hồ sơ user ERP từ `permission_api.erp_users` (ghi bởi API provision có
 * service key). Email/tên chỉ lấy ở đây, không lấy từ JWT trên trình duyệt:
 * Outline khớp account theo email đã verify, nên ai điều khiển được claim email
 * là chiếm được account trùng email.
 */
export function createErpUserDirectoryReader(
  pool: pg.Pool,
  systemAdminEmail: string,
): ErpUserDirectoryReader {
  const reservedEmail = systemAdminEmail.toLowerCase();

  return async (erpUserId) => {
    const result = await pool.query<{
      erp_user_id: string;
      email: string;
      display_name: string;
      status: string;
    }>(
      `SELECT erp_user_id, email, display_name, status
       FROM permission_api.erp_users WHERE erp_user_id = $1`,
      [erpUserId],
    );
    const row = result.rows[0];
    if (!row) return { found: false, reason: "unknown_user" };
    if (row.status !== "active") return { found: false, reason: "deactivated" };
    // User ERP mang email của system_admin sẽ được Outline gộp vào account admin.
    if (row.email.toLowerCase() === reservedEmail) {
      return { found: false, reason: "email_reserved_for_system_admin" };
    }
    return {
      found: true,
      user: {
        erpUserId: row.erp_user_id,
        email: row.email,
        displayName: row.display_name,
      },
    };
  };
}
