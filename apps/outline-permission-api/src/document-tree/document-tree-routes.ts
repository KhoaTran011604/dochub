import type Router from "@koa/router";
import { z } from "zod";
import { addAuditDetails } from "../audit/api-audit-logger.ts";
import { badRequest } from "../http/api-error.ts";
import { assertProjectKeyAllowed, getServiceClient } from "../http/service-key-authentication-middleware.ts";
import { PROJECT_KEY_PATTERN } from "../projects/project-group-naming-convention.ts";
import type { LoadProjectDocumentTreeService } from "./load-project-document-tree-service.ts";

const MAX_DEPTH = 5;

const treeQuerySchema = z.object({
  actingErpUserId: z.uuid(),
  parentDocumentId: z.uuid().optional(),
  depth: z.coerce.number().int().min(1).max(MAX_DEPTH).default(2),
});

export function registerDocumentTreeRoutes(router: Router, deps: { service: LoadProjectDocumentTreeService }): void {
  router.get("/projects/:projectKey/document-tree", async (ctx) => {
    const projectKey = ctx.params.projectKey ?? "";
    if (!PROJECT_KEY_PATTERN.test(projectKey)) {
      throw badRequest("INVALID_PROJECT_KEY", `"projectKey" must match ${PROJECT_KEY_PATTERN}, got "${projectKey}".`);
    }
    const client = getServiceClient(ctx.state);
    assertProjectKeyAllowed(client, projectKey);
    const query = treeQuerySchema.parse(ctx.query);
    addAuditDetails(ctx.state, { actingErpUserId: query.actingErpUserId, projectKey });

    const result = await deps.service.load(client.id, { projectKey, ...query });
    if (result.kind === "grant-required") {
      addAuditDetails(ctx.state, { resultStatus: 409 });
      ctx.status = 409;
      ctx.body = {
        error: { code: "OUTLINE_GRANT_REQUIRED", message: "The user must grant access in Outline first; open grantUrl." },
        grantUrl: result.grantUrl,
      };
      return;
    }
    ctx.body = result.body;
  });
}
