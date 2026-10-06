import type Router from "@koa/router";
import { z } from "zod";
import { addAuditDetails } from "../audit/api-audit-logger.ts";
import { badRequest } from "../http/api-error.ts";
import { assertProjectKeyAllowed, getServiceClient } from "../http/service-key-authentication-middleware.ts";
import { parseJsonBody, parseUuidParam } from "../http/validate-request-with-zod.ts";
import { PROJECT_KEY_PATTERN } from "./project-group-naming-convention.ts";
import type { ProjectCollectionMapRecord } from "./project-collection-map-repository.ts";
import type { ListProjectMembersService } from "./list-project-members-service.ts";
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

const projectRoleSchema = z.enum(["viewer", "editor", "manager"]);
const createProjectBodySchema = z.object({ name: z.string().min(1).max(200) });
const setMemberRoleBodySchema = z.object({ role: projectRoleSchema });
const inviteBodySchema = z.object({ email: z.email(), role: projectRoleSchema });

export function registerProjectsRoutes(
  router: Router,
  deps: {
    outlineUrl: string;
    ensureProject: (projectKey: string, name: string) => Promise<ProjectCollectionMapRecord>;
    memberRoleService: SetProjectMemberRoleService;
    listMembersService: ListProjectMembersService;
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

  /** Quyền mức collection (role dự án) hiện có — để ERP hiển thị/đổi, phân biệt với quyền mức node. */
  router.get("/projects/:projectKey/members", async (ctx) => {
    const projectKey = parseProjectKey(ctx.params.projectKey);
    assertProjectKeyAllowed(getServiceClient(ctx.state), projectKey);
    addAuditDetails(ctx.state, { projectKey });
    ctx.body = { projectKey, members: await deps.listMembersService.list(projectKey) };
  });

  /** Mời/đổi role collection theo email bất kỳ (không cần là user ERP). */
  router.put("/projects/:projectKey/invitations", async (ctx) => {
    const projectKey = parseProjectKey(ctx.params.projectKey);
    assertProjectKeyAllowed(getServiceClient(ctx.state), projectKey);
    const body = await parseJsonBody(ctx, inviteBodySchema);
    addAuditDetails(ctx.state, { projectKey, email: body.email, role: body.role });

    await deps.memberRoleService.setRoleByEmail(projectKey, body.email, body.role);
    ctx.body = { projectKey, email: body.email, role: body.role };
  });

  router.delete("/projects/:projectKey/invitations", async (ctx) => {
    const projectKey = parseProjectKey(ctx.params.projectKey);
    assertProjectKeyAllowed(getServiceClient(ctx.state), projectKey);
    const parsed = z.email().safeParse(ctx.query.email);
    if (!parsed.success) throw badRequest("INVALID_EMAIL", "Query `email` must be a valid email.");
    addAuditDetails(ctx.state, { projectKey, email: parsed.data });

    await deps.memberRoleService.removeMemberByEmail(projectKey, parsed.data);
    ctx.status = 204;
  });

  router.put("/projects/:projectKey/members/:erpUserId", async (ctx) => {
    const projectKey = parseProjectKey(ctx.params.projectKey);
    const erpUserId = parseErpUserId(ctx.params.erpUserId);
    assertProjectKeyAllowed(getServiceClient(ctx.state), projectKey);
    const body = await parseJsonBody(ctx, setMemberRoleBodySchema);
    addAuditDetails(ctx.state, { projectKey, erpUserId, role: body.role });

    await deps.memberRoleService.setRole(projectKey, erpUserId, body.role);
    ctx.body = { projectKey, erpUserId, role: body.role };
  });

  router.delete("/projects/:projectKey/members/:erpUserId", async (ctx) => {
    const projectKey = parseProjectKey(ctx.params.projectKey);
    const erpUserId = parseErpUserId(ctx.params.erpUserId);
    assertProjectKeyAllowed(getServiceClient(ctx.state), projectKey);
    addAuditDetails(ctx.state, { projectKey, erpUserId });

    await deps.memberRoleService.removeMember(projectKey, erpUserId);
    ctx.status = 204;
  });
}
