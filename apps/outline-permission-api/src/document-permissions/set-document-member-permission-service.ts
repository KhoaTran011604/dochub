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
import type { MailerService } from "../mail/mailer.ts";

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
  mailer: MailerService;
  outlineUrl: string;
}): SetDocumentMemberPermissionService {
  async function loadOutlineUser(erpUserId: string): Promise<{ outlineUserId: string; email: string }> {
    const user = await deps.erpUserRepository.findByErpUserId(erpUserId);
    if (!user?.outlineUserId) {
      throw notFound("USER_NOT_IN_OUTLINE", `ERP user "${erpUserId}" has no Outline account yet.`);
    }
    return { outlineUserId: user.outlineUserId, email: user.email };
  }

  return {
    async setPermission(serviceClient, documentId, erpUserId, permission) {
      await resolveDocumentProjectScope(deps.outlineClient, deps.mapRepository, serviceClient, documentId);
      const user = await loadOutlineUser(erpUserId);
      // Suppress Outline's built-in email by passing false, and send our own
      await addUserToDocument(deps.outlineClient, documentId, user.outlineUserId, permission, false);

      await deps.mailer.sendDocumentInviteEmail({
        toEmail: user.email,
        documentId,
        documentUrl: `${deps.outlineUrl}/doc/${documentId}`,
        permission,
      });
    },

    async removeMember(serviceClient, documentId, erpUserId) {
      await resolveDocumentProjectScope(deps.outlineClient, deps.mapRepository, serviceClient, documentId);
      const user = await loadOutlineUser(erpUserId);
      await removeUserFromDocument(deps.outlineClient, documentId, user.outlineUserId);
    },
  };
}
