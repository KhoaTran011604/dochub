import {
  addUserToDocument,
  findUserByEmail,
  listDocumentMemberships,
  listUsersByIds,
  removeUserFromDocument,
  type OutlineHttpClient,
  type OutlinePermission,
} from "@hd-document/outline-api-client";
import { forbidden, notFound } from "../http/api-error.ts";
import type { AuthenticatedServiceClient } from "../http/service-key-authentication-middleware.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import { findOrInviteOutlineUserByEmail } from "../users/find-or-invite-outline-user-by-email.ts";
import { resolveDocumentProjectScope } from "./resolve-document-project-scope.ts";
import type { MailerService } from "../mail/mailer.ts";

export interface DocumentMemberView {
  /** null = người ngoài ERP (mời thẳng bằng email). */
  erpUserId: string | null;
  email: string;
  name: string;
  permission: OutlinePermission;
}

export interface SetDocumentMemberPermissionService {
  /** Quyền trực tiếp trên doc của các user ERP (user Outline không map được bị bỏ qua, vd system admin). */
  listMembers(serviceClient: AuthenticatedServiceClient, documentId: string): Promise<DocumentMemberView[]>;
  setPermission(
    serviceClient: AuthenticatedServiceClient,
    documentId: string,
    erpUserId: string,
    permission: OutlinePermission,
  ): Promise<void>;
  /** Mời bất kỳ email nào (tạo tài khoản Outline nếu chưa có) rồi cấp quyền + gửi mail. */
  setPermissionByEmail(
    serviceClient: AuthenticatedServiceClient,
    documentId: string,
    email: string,
    permission: OutlinePermission,
  ): Promise<void>;
  removeMemberByEmail(serviceClient: AuthenticatedServiceClient, documentId: string, email: string): Promise<void>;
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
  systemAdminEmail?: string;
}): SetDocumentMemberPermissionService {
  const isReserved = (email: string) => email.toLowerCase() === deps.systemAdminEmail?.toLowerCase();
  const assertNotReserved = (email: string) => {
    if (isReserved(email)) throw forbidden("SYSTEM_ADMIN_EMAIL_RESERVED", "This account cannot be changed via API.");
  };

  async function loadOutlineUser(erpUserId: string): Promise<{ outlineUserId: string; email: string }> {
    const user = await deps.erpUserRepository.findByErpUserId(erpUserId);
    if (!user?.outlineUserId) {
      throw notFound("USER_NOT_IN_OUTLINE", `ERP user "${erpUserId}" has no Outline account yet.`);
    }
    return { outlineUserId: user.outlineUserId, email: user.email };
  }

  return {
    async listMembers(serviceClient, documentId) {
      await resolveDocumentProjectScope(deps.outlineClient, deps.mapRepository, serviceClient, documentId);
      const { memberships } = await listDocumentMemberships(deps.outlineClient, documentId);
      const erpUsers = await deps.erpUserRepository.findByOutlineUserIds(memberships.map((item) => item.userId));
      const erpByOutlineId = new Map(erpUsers.map((user) => [user.outlineUserId, user]));
      const unmappedIds = memberships.map((item) => item.userId).filter((id) => !erpByOutlineId.has(id));
      const outlineUsers = await listUsersByIds(deps.outlineClient, unmappedIds);
      const outlineById = new Map(outlineUsers.map((user) => [user.id, user]));
      return memberships.flatMap((item): DocumentMemberView[] => {
        const erp = erpByOutlineId.get(item.userId);
        if (erp) return [{ erpUserId: erp.erpUserId, email: erp.email, name: erp.displayName, permission: item.permission }];
        const outline = outlineById.get(item.userId);
        if (!outline?.email || isReserved(outline.email)) return [];
        return [{ erpUserId: null, email: outline.email, name: outline.name, permission: item.permission }];
      });
    },

    async setPermissionByEmail(serviceClient, documentId, email, permission) {
      assertNotReserved(email);
      await resolveDocumentProjectScope(deps.outlineClient, deps.mapRepository, serviceClient, documentId);
      const user = await findOrInviteOutlineUserByEmail(deps.outlineClient, email);
      await addUserToDocument(deps.outlineClient, documentId, user.id, permission, false);
      await deps.mailer.sendDocumentInviteEmail({
        toEmail: email,
        documentId,
        documentUrl: `${deps.outlineUrl}/doc/${documentId}`,
        permission,
      });
    },

    async removeMemberByEmail(serviceClient, documentId, email) {
      assertNotReserved(email);
      await resolveDocumentProjectScope(deps.outlineClient, deps.mapRepository, serviceClient, documentId);
      const user = await findUserByEmail(deps.outlineClient, email);
      if (!user) throw notFound("USER_NOT_IN_OUTLINE", `No Outline account for "${email}".`);
      await removeUserFromDocument(deps.outlineClient, documentId, user.id);
    },

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
