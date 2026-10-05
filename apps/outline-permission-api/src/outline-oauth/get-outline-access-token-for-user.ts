import { OutlineOAuthError, type OutlineOAuthTokens } from "@hd-document/outline-api-client";
import type { UserOutlineGrantRepository } from "./user-outline-grant-repository.ts";

export type GetOutlineAccessTokenForUser = (
  erpUserId: string,
  /** Grant cũ thiếu scope này → coi như chưa có grant (giữ nguyên dòng, lần đồng ý tới ghi đè). */
  requiredScope?: string,
) => Promise<string | undefined>;

const hasScope = (granted: string, required: string): boolean => granted.split(/[\s,]+/).includes(required);

/** Dùng lại access token còn ít nhất chừng này, tránh hết hạn giữa chừng lúc gọi. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Trả access token Outline còn hạn của user, hoặc `undefined` khi cần user
 * đồng ý lại (chưa có grant / `invalid_grant`). Cache = chính cột
 * `access_token_expires_at` (`/oauth/token` giới hạn 100 request/giờ).
 * Refresh chạy trong khóa hàng: 2 request cùng lúc → request sau thấy token
 * mới của request trước, chỉ 1 lần gọi `/oauth/token`. Lỗi khác `invalid_grant`
 * (mạng, 5xx) ném tiếp, transaction rollback, grant giữ nguyên.
 */
export function createGetOutlineAccessTokenForUser(deps: {
  grantRepository: UserOutlineGrantRepository;
  refresh: (refreshToken: string) => Promise<OutlineOAuthTokens>;
  now?: () => Date;
}): GetOutlineAccessTokenForUser {
  const now = deps.now ?? (() => new Date());
  return (erpUserId, requiredScope) =>
    deps.grantRepository.withLockedGrant(erpUserId, async (grant, handle) => {
      if (!grant) return undefined;
      if (requiredScope && !hasScope(grant.scope, requiredScope)) return undefined;
      if (grant.accessTokenExpiresAt.getTime() - EXPIRY_SKEW_MS > now().getTime()) {
        return grant.accessToken;
      }
      try {
        const tokens = await deps.refresh(grant.refreshToken);
        await handle.save({
          erpUserId,
          refreshToken: tokens.refreshToken,
          accessToken: tokens.accessToken,
          accessTokenExpiresAt: tokens.expiresAt,
          scope: tokens.scope || grant.scope,
        });
        return tokens.accessToken;
      } catch (error) {
        if (error instanceof OutlineOAuthError && error.code === "invalid_grant") {
          await handle.remove();
          return undefined;
        }
        throw error;
      }
    });
}
