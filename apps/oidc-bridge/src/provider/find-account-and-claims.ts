import type { Account, FindAccount } from "oidc-provider";
import type { ErpUserDirectoryReader } from "../accounts/erp-user-directory-reader.ts";

export const SYSTEM_ADMIN_ACCOUNT_ID = "local:system_admin";
const ERP_ACCOUNT_PREFIX = "erp:";

export const erpAccountId = (erpUserId: string) =>
  `${ERP_ACCOUNT_PREFIX}${erpUserId}`;

export interface SystemAdminProfile {
  username: string;
  email: string;
  displayName: string;
}

function account(
  accountId: string,
  profile: { email: string; name: string; preferredUsername: string },
): Account {
  return {
    accountId,
    // Provider tự lọc claim theo scope (cấu hình `claims`).
    claims: () => ({
      sub: accountId,
      email: profile.email,
      // Luôn true: Outline chỉ khớp account đã invite khi email đã verify.
      // An toàn vì email chỉ đến từ env (admin) hoặc API provision (user ERP).
      email_verified: true,
      name: profile.name,
      preferred_username: profile.preferredUsername,
    }),
  };
}

/**
 * `findAccount` của oidc-provider: được gọi lại ở token/userinfo chỉ với `sub`.
 * Trả `undefined` khi user ERP không còn active → Outline nhận lỗi ở lần kiểm
 * userinfo kế tiếp và thu phiên của user đó.
 */
export function createFindAccount(
  systemAdmin: SystemAdminProfile,
  readErpUser: ErpUserDirectoryReader,
): FindAccount {
  return async (_ctx, sub) => {
    if (sub === SYSTEM_ADMIN_ACCOUNT_ID) {
      return account(sub, {
        email: systemAdmin.email,
        name: systemAdmin.displayName,
        preferredUsername: systemAdmin.username,
      });
    }
    if (!sub.startsWith(ERP_ACCOUNT_PREFIX)) return undefined;

    const lookup = await readErpUser(sub.slice(ERP_ACCOUNT_PREFIX.length));
    if (!lookup.found) return undefined;
    return account(sub, {
      email: lookup.user.email,
      name: lookup.user.displayName,
      preferredUsername: lookup.user.email,
    });
  };
}
