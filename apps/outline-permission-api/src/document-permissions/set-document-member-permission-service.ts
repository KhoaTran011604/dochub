import {
  addUserToDocument,
  removeUserFromDocument,
  type OutlineHttpClient,
  type OutlinePermission,
} from "@hd-document/outline-api-client";
import { notFound } from "../http/api-error.ts";
import type { AuthenticatedServiceClient } from "../http/service-key-authentication-middleware.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import { resolveDocumentProjectScope } from "./resolve-document-project-scope.ts";

export interface SetDocumentMemberPermissionService {
  setPermission(
    serviceClient: AuthenticatedServiceClient,
    documentId: string,
    erpUserId: string,
    permission: OutlinePermission,
  ): Promise<void>;
  removeMember(
    serviceClient: AuthenticatedServiceClient,
    documentId: string,
    erpUserId: string,
  ): Promise<void>;
}

export function createSetDocumentMemberPermissionService(deps: {
  outlineClient: OutlineHttpClient;
  mapRepository: ProjectCollectionMapRepository;
  erpUserRepository: ErpUserRepository;
}): SetDocumentMemberPermissionService {
  async function loadOutlineUserId(erpUserId: string): Promise<string> {
    const user = await deps.erpUserRepository.findByErpUserId(erpUserId);
    if (!user?.outlineUserId) {
      throw notFound("USER_NOT_IN_OUTLINE", `ERP user "${erpUserId}" has no Outline account yet.`);
    }
    return user.outlineUserId;
  }

  return {
    async setPermission(serviceClient, documentId, erpUserId, permission) {
      await resolveDocumentProjectScope(deps.outlineClient, deps.mapRepository, serviceClient, documentId);
      const outlineUserId = await loadOutlineUserId(erpUserId);
      await addUserToDocument(deps.outlineClient, documentId, outlineUserId, permission);
    },

    async removeMember(serviceClient, documentId, erpUserId) {
      await resolveDocumentProjectScope(deps.outlineClient, deps.mapRepository, serviceClient, documentId);
      const outlineUserId = await loadOutlineUserId(erpUserId);
      await removeUserFromDocument(deps.outlineClient, documentId, outlineUserId);
    },
  };
}
