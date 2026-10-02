import { addUserToGroup, removeUserFromGroup, type OutlineHttpClient } from "@hd-document/outline-api-client";
import { notFound } from "../http/api-error.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
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
}): SetProjectMemberRoleService {
  async function loadContext(
    projectKey: string,
    erpUserId: string,
  ): Promise<{ map: ProjectCollectionMapRecord; outlineUserId: string }> {
    const map = await deps.mapRepository.findByProjectKey(projectKey);
    if (!map) throw notFound("PROJECT_NOT_FOUND", `No project "${projectKey}".`);
    const user = await deps.erpUserRepository.findByErpUserId(erpUserId);
    if (!user?.outlineUserId) {
      throw notFound("USER_NOT_IN_OUTLINE", `ERP user "${erpUserId}" has no Outline account yet.`);
    }
    return { map, outlineUserId: user.outlineUserId };
  }

  return {
    async setRole(projectKey, erpUserId, role) {
      const { map, outlineUserId } = await loadContext(projectKey, erpUserId);
      const otherRoles = PROJECT_ROLES.filter((candidate) => candidate !== role);
      for (const otherRole of otherRoles) {
        await removeUserFromGroup(deps.outlineClient, groupIdForRole(map, otherRole), outlineUserId);
      }
      await addUserToGroup(deps.outlineClient, groupIdForRole(map, role), outlineUserId);
    },

    async removeMember(projectKey, erpUserId) {
      const { map, outlineUserId } = await loadContext(projectKey, erpUserId);
      for (const role of PROJECT_ROLES) {
        await removeUserFromGroup(deps.outlineClient, groupIdForRole(map, role), outlineUserId);
      }
    },
  };
}
