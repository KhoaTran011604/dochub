import { listGroupMemberUserIds, listUsersByIds, type OutlineHttpClient } from "@hd-document/outline-api-client";
import { notFound } from "../http/api-error.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import type { ProjectRole } from "./project-group-naming-convention.ts";
import type { ProjectCollectionMapRepository } from "./project-collection-map-repository.ts";

export interface ProjectMemberView {
  /** null = người ngoài ERP (được mời thẳng bằng email). */
  erpUserId: string | null;
  email: string;
  name: string;
  role: ProjectRole;
}

export interface ListProjectMembersService {
  /** Ai đang có role collection (qua 3 group của dự án): user ERP + người được mời theo email. */
  list(projectKey: string): Promise<ProjectMemberView[]>;
}

export function createListProjectMembersService(deps: {
  outlineClient: OutlineHttpClient;
  mapRepository: ProjectCollectionMapRepository;
  erpUserRepository: ErpUserRepository;
  systemAdminEmail?: string;
}): ListProjectMembersService {
  const isReserved = (email: string) => email.toLowerCase() === deps.systemAdminEmail?.toLowerCase();

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
      const outlineIds = [...roleByOutlineId.keys()];
      const erpUsers = await deps.erpUserRepository.findByOutlineUserIds(outlineIds);
      const erpByOutlineId = new Map(erpUsers.map((user) => [user.outlineUserId, user]));
      const outlineUsers = await listUsersByIds(deps.outlineClient, outlineIds.filter((id) => !erpByOutlineId.has(id)));
      const outlineById = new Map(outlineUsers.map((user) => [user.id, user]));

      return outlineIds.flatMap((outlineUserId): ProjectMemberView[] => {
        const role = roleByOutlineId.get(outlineUserId) as ProjectRole;
        const erp = erpByOutlineId.get(outlineUserId);
        if (erp) return [{ erpUserId: erp.erpUserId, email: erp.email, name: erp.displayName, role }];
        const outline = outlineById.get(outlineUserId);
        if (!outline?.email || isReserved(outline.email)) return [];
        return [{ erpUserId: null, email: outline.email, name: outline.name, role }];
      });
    },
  };
}
