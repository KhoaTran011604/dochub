import type Router from "@koa/router";
import { z } from "zod";
import { badRequest } from "../http/api-error.ts";
import { assertProjectKeyAllowed, getServiceClient } from "../http/service-key-authentication-middleware.ts";
import { parseJsonBody, parseUuidParam } from "../http/validate-request-with-zod.ts";
import { PROJECT_KEY_PATTERN } from "./project-group-naming-convention.ts";
import type { ProjectCollectionMapRecord } from "./project-collection-map-repository.ts";
import type { SetProjectMemberRoleService } from "./set-project-member-role-service.ts";

function parseProjectKey(raw: string | undefined): string {
  const value = raw ?? "";
  if (!PROJECT_KEY_PATTERN.test(value)) {
    throw badRequest("INVALID_PROJECT_KEY", `"projectKey" must match ${PROJECT_KEY_PATTERN}, got "${value}".`);
  }
  return value;
}

const parseErpUserId = (raw: string | undefined) =>
  parseUuidParam(raw, "ERP_USER_ID_NOT_UUID", "erpUserId");

const createProjectBodySchema = z.object({ name: z.string().min(1).max(200) });
const setMemberRoleBodySchema = z.object({ role: z.enum(["viewer", "editor", "manager"]) });

export function registerProjectsRoutes(
  router: Router,
  deps: {
    outlineUrl: string;
    ensureProject: (projectKey: string, name: string) => Promise<ProjectCollectionMapRecord>;
    memberRoleService: SetProjectMemberRoleService;
  },
): void {
  router.put("/projects/:projectKey", async (ctx) => {
    const projectKey = parseProjectKey(ctx.params.projectKey);
    assertProjectKeyAllowed(getServiceClient(ctx.state), projectKey);
    const body = await parseJsonBody(ctx, createProjectBodySchema);

    const map = await deps.ensureProject(projectKey, body.name);
    ctx.body = {
      projectKey: map.projectKey,
      collectionId: map.collectionId,
      url: `${deps.outlineUrl}/collection/${map.collectionId}`,
    };
  });

  router.put("/projects/:projectKey/members/:erpUserId", async (ctx) => {
    const projectKey = parseProjectKey(ctx.params.projectKey);
    const erpUserId = parseErpUserId(ctx.params.erpUserId);
    assertProjectKeyAllowed(getServiceClient(ctx.state), projectKey);
    const body = await parseJsonBody(ctx, setMemberRoleBodySchema);

    await deps.memberRoleService.setRole(projectKey, erpUserId, body.role);
    ctx.body = { projectKey, erpUserId, role: body.role };
  });

  router.delete("/projects/:projectKey/members/:erpUserId", async (ctx) => {
    const projectKey = parseProjectKey(ctx.params.projectKey);
    const erpUserId = parseErpUserId(ctx.params.erpUserId);
    assertProjectKeyAllowed(getServiceClient(ctx.state), projectKey);

    await deps.memberRoleService.removeMember(projectKey, erpUserId);
    ctx.status = 204;
  });
}
