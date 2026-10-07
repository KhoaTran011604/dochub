import type Router from "@koa/router";
import { getServiceClient } from "../http/service-key-authentication-middleware.ts";
import { parseUuidParam } from "../http/validate-request-with-zod.ts";
import type { GetDocumentContentService } from "./get-document-content-service.ts";

const parseDocumentId = (raw: string | undefined) =>
  parseUuidParam(raw, "DOCUMENT_ID_NOT_UUID", "documentId");

export function registerDocumentContentRoutes(
  router: Router,
  deps: { service: GetDocumentContentService },
): void {
  router.get("/documents/:documentId/content", async (ctx) => {
    const documentId = parseDocumentId(ctx.params.documentId);
    const content = await deps.service.getContent(getServiceClient(ctx.state), documentId);
    ctx.body = { documentId, ...content };
  });
}
