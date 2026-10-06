import { listGroupMemberUserIds, type OutlineHttpClient } from "@hd-document/outline-api-client";
import { notFound } from "../http/api-error.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import type { ProjectRole } from "./project-group-naming-convention.ts";
import type { ProjectCollectionMapRepository } from "./project-collection-map-repository.ts";

export interface ProjectMemberView {
  erpUserId: string;
  email: string;
  name: string;
  role: ProjectRole;
}

export interface ListProjectMembersService {
  /** User ERP đang có role collection (qua 3 group của dự án). User Outline không map được ERP bị bỏ qua. */
  list(projectKey: string): Promise<ProjectMemberView[]>;
}

export function createListProjectMembersService(deps: {
  outlineClient: OutlineHttpClient;
  mapRepository: ProjectCollectionMapRepository;
  erpUserRepository: ErpUserRepository;
}): ListProjectMembersService {
  return {
    async list(projectKey) {
      const map = await deps.mapRepository.findByProjectKey(projectKey);
      if (!map) throw notFound("PROJECT_NOT_FOUND", `No project "${projectKey}".`);

      const groups: Array<{ role: ProjectRole; groupId: string }> = [
        { role: "manager", groupId: map.managerGroupId },
        { role: "editor", groupId: map.editorGroupId },
        { role: "viewer", groupId: map.viewerGroupId },
      ];
      const roleByOutlineId = new Map<string, ProjectRole>();
      for (const group of groups) {
        for (const outlineUserId of await listGroupMemberUserIds(deps.outlineClient, group.groupId)) {
          // Thứ tự manager → viewer: nếu lỡ nằm 2 group (crash giữa chừng), ghi role cao nhất.
          if (!roleByOutlineId.has(outlineUserId)) roleByOutlineId.set(outlineUserId, group.role);
        }
      }
      const users = await deps.erpUserRepository.findByOutlineUserIds([...roleByOutlineId.keys()]);
      return users.flatMap((user): ProjectMemberView[] => {
        const role = user.outlineUserId ? roleByOutlineId.get(user.outlineUserId) : undefined;
        return role ? [{ erpUserId: user.erpUserId, email: user.email, name: user.displayName, role }] : [];
      });
    },
  };
}
