import {
  addUserToGroup,
  findUserByEmail,
  removeUserFromGroup,
  type OutlineHttpClient,
} from "@hd-document/outline-api-client";
import { forbidden, notFound } from "../http/api-error.ts";
import type { MailerService } from "../mail/mailer.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import { findOrInviteOutlineUserByEmail } from "../users/find-or-invite-outline-user-by-email.ts";
import { PROJECT_ROLES, type ProjectRole } from "./project-group-naming-convention.ts";
import type { ProjectCollectionMapRecord, ProjectCollectionMapRepository } from "./project-collection-map-repository.ts";

function groupIdForRole(map: ProjectCollectionMapRecord, role: ProjectRole): string {
  switch (role) {
    case "viewer":
      return map.viewerGroupId;
    case "editor":
      return map.editorGroupId;
    case "manager":
      return map.managerGroupId;
  }
}

export interface SetProjectMemberRoleService {
  setRole(projectKey: string, erpUserId: string, role: ProjectRole): Promise<void>;
  removeMember(projectKey: string, erpUserId: string): Promise<void>;
  /** Cấp role collection cho bất kỳ email (tạo tài khoản Outline nếu chưa có) + gửi mail thông báo. */
  setRoleByEmail(projectKey: string, email: string, role: ProjectRole): Promise<void>;
  removeMemberByEmail(projectKey: string, email: string): Promise<void>;
}

/**
 * Đổi role dự án: gỡ khỏi group cũ TRƯỚC, thêm vào group mới SAU (fail
 * closed — lỗi giữa chừng → user mất quyền tạm, không thừa quyền). ERP gọi
 * lại PUT là hội tụ. Xem phase-04, mục Key Insights.
 */
export function createSetProjectMemberRoleService(deps: {
  outlineClient: OutlineHttpClient;
  mapRepository: ProjectCollectionMapRepository;
  erpUserRepository: ErpUserRepository;
  mailer: MailerService;
  outlineUrl: string;
  systemAdminEmail?: string;
}): SetProjectMemberRoleService {
  const assertNotReserved = (email: string) => {
    if (email.toLowerCase() === deps.systemAdminEmail?.toLowerCase()) {
      throw forbidden("SYSTEM_ADMIN_EMAIL_RESERVED", "This account cannot be changed via API.");
    }
  };

  async function loadMap(projectKey: string): Promise<ProjectCollectionMapRecord> {
    const map = await deps.mapRepository.findByProjectKey(projectKey);
    if (!map) throw notFound("PROJECT_NOT_FOUND", `No project "${projectKey}".`);
    return map;
  }

  async function loadOutlineUserId(erpUserId: string): Promise<string> {
    const user = await deps.erpUserRepository.findByErpUserId(erpUserId);
    if (!user?.outlineUserId) {
      throw notFound("USER_NOT_IN_OUTLINE", `ERP user "${erpUserId}" has no Outline account yet.`);
    }
    return user.outlineUserId;
  }

  async function applyRole(map: ProjectCollectionMapRecord, outlineUserId: string, role: ProjectRole): Promise<void> {
    for (const otherRole of PROJECT_ROLES.filter((candidate) => candidate !== role)) {
      await removeUserFromGroup(deps.outlineClient, groupIdForRole(map, otherRole), outlineUserId);
    }
    await addUserToGroup(deps.outlineClient, groupIdForRole(map, role), outlineUserId);
  }

  async function clearRoles(map: ProjectCollectionMapRecord, outlineUserId: string): Promise<void> {
    for (const role of PROJECT_ROLES) {
      await removeUserFromGroup(deps.outlineClient, groupIdForRole(map, role), outlineUserId);
    }
  }

  return {
    async setRole(projectKey, erpUserId, role) {
      const map = await loadMap(projectKey);
      await applyRole(map, await loadOutlineUserId(erpUserId), role);
    },

    async removeMember(projectKey, erpUserId) {
      const map = await loadMap(projectKey);
      await clearRoles(map, await loadOutlineUserId(erpUserId));
    },

    async setRoleByEmail(projectKey, email, role) {
      assertNotReserved(email);
      const map = await loadMap(projectKey);
      const user = await findOrInviteOutlineUserByEmail(deps.outlineClient, email);
      await applyRole(map, user.id, role);
      await deps.mailer.sendCollectionInviteEmail({
        toEmail: email,
        collectionUrl: `${deps.outlineUrl}/collection/${map.collectionId}`,
        role,
      });
    },

    async removeMemberByEmail(projectKey, email) {
      assertNotReserved(email);
      const map = await loadMap(projectKey);
      const user = await findUserByEmail(deps.outlineClient, email);
      if (!user) throw notFound("USER_NOT_IN_OUTLINE", `No Outline account for "${email}".`);
      await clearRoles(map, user.id);
    },
  };
}
