import { revokeOAuthToken, type OutlineOAuthCredentials } from "@hd-document/outline-api-client";
import type { UserOutlineGrantRepository } from "./user-outline-grant-repository.ts";

export type RevokeUserOutlineGrant = (erpUserId: string) => Promise<void>;

/**
 * Xóa grant khỏi DB TRƯỚC (đây là phần fail-closed), rồi thu hồi 2 token phía
 * Outline theo kiểu best-effort: lỗi mạng không được chặn deactivate.
 */
export function createRevokeUserOutlineGrant(deps: {
  grantRepository: UserOutlineGrantRepository;
  credentials: OutlineOAuthCredentials;
}): RevokeUserOutlineGrant {
  return async (erpUserId) => {
    const grant = await deps.grantRepository.delete(erpUserId);
    if (!grant) return;
    for (const token of [grant.refreshToken, grant.accessToken]) {
      try {
        await revokeOAuthToken(deps.credentials, token);
      } catch (error) {
        // Chỉ log loại lỗi, không log token.
        console.error(`oauth revoke failed for ${erpUserId}:`, error instanceof Error ? error.message : "unknown");
      }
    }
  };
}
