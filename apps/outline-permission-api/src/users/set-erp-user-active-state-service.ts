import { activateUser, suspendUser, type OutlineHttpClient } from "@hd-document/outline-api-client";
import { forbidden, notFound } from "../http/api-error.ts";
import type { ErpUserRepository } from "./erp-user-repository.ts";

export interface SetErpUserActiveStateService {
  deactivate(erpUserId: string): Promise<void>;
  activate(erpUserId: string): Promise<void>;
}

function assertNotSystemAdmin(email: string, systemAdminEmail: string): void {
  if (email.toLowerCase() === systemAdminEmail.toLowerCase()) {
    throw forbidden(
      "SYSTEM_ADMIN_PROTECTED",
      "system_admin cannot be suspended or activated through this API.",
    );
  }
}

/**
 * Thứ tự fail-closed: deactivate ghi `erp_users.status` TRƯỚC khi gọi Outline
 * (bridge chặn SSO ngay dù lệnh suspend Outline sau đó lỗi); activate gọi
 * Outline TRƯỚC, ghi `status = active` SAU (lỗi giữa chừng → user vẫn bị
 * chặn, không bao giờ thừa quyền). Xem phase-04, mục Key Insights.
 */
export function createSetErpUserActiveStateService(deps: {
  repository: ErpUserRepository;
  outlineClient: OutlineHttpClient;
  systemAdminEmail: string;
}): SetErpUserActiveStateService {
  async function loadOutlineManagedUser(
    erpUserId: string,
  ): Promise<{ email: string; outlineUserId: string }> {
    const user = await deps.repository.findByErpUserId(erpUserId);
    if (!user) throw notFound("USER_NOT_FOUND", `No ERP user "${erpUserId}".`);
    assertNotSystemAdmin(user.email, deps.systemAdminEmail);
    if (!user.outlineUserId) {
      throw notFound("USER_NOT_IN_OUTLINE", `ERP user "${erpUserId}" has no Outline account yet.`);
    }
    return { email: user.email, outlineUserId: user.outlineUserId };
  }

  return {
    async deactivate(erpUserId) {
      const user = await loadOutlineManagedUser(erpUserId);
      await deps.repository.setStatus(erpUserId, "deactivated");
      await suspendUser(deps.outlineClient, user.outlineUserId);
    },

    async activate(erpUserId) {
      const user = await loadOutlineManagedUser(erpUserId);
      await activateUser(deps.outlineClient, user.outlineUserId);
      await deps.repository.setStatus(erpUserId, "active");
    },
  };
}
