import type Router from "@koa/router";
import { z } from "zod";
import { getServiceClient } from "../http/service-key-authentication-middleware.ts";
import { parseJsonBody, parseUuidParam } from "../http/validate-request-with-zod.ts";
import type { SetDocumentMemberPermissionService } from "./set-document-member-permission-service.ts";

const parseErpUserId = (raw: string | undefined) =>
  parseUuidParam(raw, "ERP_USER_ID_NOT_UUID", "erpUserId");
const parseDocumentId = (raw: string | undefined) =>
  parseUuidParam(raw, "DOCUMENT_ID_NOT_UUID", "documentId");

const setPermissionBodySchema = z.object({ permission: z.enum(["read", "read_write"]) });

export function registerDocumentMembersRoutes(
  router: Router,
  deps: { service: SetDocumentMemberPermissionService },
): void {
  router.put("/documents/:documentId/members/:erpUserId", async (ctx) => {
    const documentId = parseDocumentId(ctx.params.documentId);
    const erpUserId = parseErpUserId(ctx.params.erpUserId);
    const client = getServiceClient(ctx.state);
    const body = await parseJsonBody(ctx, setPermissionBodySchema);

    await deps.service.setPermission(client, documentId, erpUserId, body.permission);
    ctx.body = { documentId, erpUserId, permission: body.permission };
  });

  router.delete("/documents/:documentId/members/:erpUserId", async (ctx) => {
    const documentId = parseDocumentId(ctx.params.documentId);
    const erpUserId = parseErpUserId(ctx.params.erpUserId);
    const client = getServiceClient(ctx.state);

    await deps.service.removeMember(client, documentId, erpUserId);
    ctx.status = 204;
  });
}
