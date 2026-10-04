import Router from "@koa/router";
import { createOutlineHttpClient } from "@hd-document/outline-api-client";
import Koa from "koa";
import type pg from "pg";
import { createApiAuditLogger, createApiAuditMiddleware } from "./audit/api-audit-logger.ts";
import type { EnvironmentConfig } from "./config/environment-config.ts";
import { registerDocumentMembersRoutes } from "./document-permissions/document-members-routes.ts";
import { createSetDocumentMemberPermissionService } from "./document-permissions/set-document-member-permission-service.ts";
import { createHealthCheckRoute } from "./health/health-check-route.ts";
import { createErrorHandlingMiddleware } from "./http/error-handling-middleware.ts";
import { createInMemoryRateLimitMiddleware } from "./http/in-memory-rate-limit-middleware.ts";
import {
  createServiceKeyAuthenticationMiddleware,
  requireScope,
} from "./http/service-key-authentication-middleware.ts";
import { ensureProjectCollectionAndGroups } from "./projects/ensure-project-collection-and-groups.ts";
import { createProjectCollectionMapRepository } from "./projects/project-collection-map-repository.ts";
import { registerProjectsRoutes } from "./projects/projects-routes.ts";
import { createSetProjectMemberRoleService } from "./projects/set-project-member-role-service.ts";
import { createServiceClientRepository } from "./service-clients/service-client-repository.ts";
import { createErpUserRepository } from "./users/erp-user-repository.ts";
import { createSetErpUserActiveStateService } from "./users/set-erp-user-active-state-service.ts";
import { createUpsertErpUsersService } from "./users/upsert-erp-users-service.ts";
import { registerUsersRoutes } from "./users/users-routes.ts";
import { createMailerService } from "./mail/mailer.ts";

/**
 * Ráp app: route công khai (/healthz) → xác thực service key → audit → rate
 * limit → route nghiệp vụ (chia 2 nhóm theo scope). Không mở port, không tạo
 * pool → test dùng lại được.
 */
export function createPermissionApiApplication(config: EnvironmentConfig, pool: pg.Pool): Koa {
  const outlineClient = createOutlineHttpClient({
    baseUrl: config.OUTLINE_INTERNAL_URL ?? config.OUTLINE_URL,
    token: config.OUTLINE_ADMIN_API_TOKEN,
  });

  const serviceClientRepository = createServiceClientRepository(pool);
  const erpUserRepository = createErpUserRepository(pool);
  const mapRepository = createProjectCollectionMapRepository(pool);
  const audit = createApiAuditLogger(pool);

  const mailer = createMailerService(
    config.SMTP_HOST,
    config.SMTP_PORT,
    config.SMTP_USER,
    config.SMTP_PASS,
    config.MAIL_FROM_EMAIL
  );

  const upsertService = createUpsertErpUsersService({
    repository: erpUserRepository,
    outlineClient,
    systemAdminEmail: config.SYSTEM_ADMIN_EMAIL,
  });
  const activeStateService = createSetErpUserActiveStateService({
    repository: erpUserRepository,
    outlineClient,
    systemAdminEmail: config.SYSTEM_ADMIN_EMAIL,
  });
  const memberRoleService = createSetProjectMemberRoleService({
    outlineClient,
    mapRepository,
    erpUserRepository,
  });
  const documentMemberService = createSetDocumentMemberPermissionService({
    outlineClient,
    mapRepository,
    erpUserRepository,
    mailer,
    outlineUrl: config.OUTLINE_URL,
  });

  const app = new Koa();
  app.proxy = config.TRUST_PROXY;
  app.use(createErrorHandlingMiddleware());

  const publicRouter = new Router();
  publicRouter.get("/healthz", createHealthCheckRoute(pool));
  app.use(publicRouter.routes());

  app.use(createServiceKeyAuthenticationMiddleware(serviceClientRepository));
  app.use(createApiAuditMiddleware(audit));
  app.use(createInMemoryRateLimitMiddleware());

  const usersRouter = new Router();
  usersRouter.use(requireScope("users:write"));
  registerUsersRoutes(usersRouter, { upsertService, activeStateService });

  const permissionsRouter = new Router();
  permissionsRouter.use(requireScope("permissions:write"));
  registerProjectsRoutes(permissionsRouter, {
    outlineUrl: config.OUTLINE_URL,
    ensureProject: (projectKey, name) =>
      ensureProjectCollectionAndGroups(outlineClient, mapRepository, projectKey, name),
    memberRoleService,
  });
  registerDocumentMembersRoutes(permissionsRouter, { service: documentMemberService });

  app.use(usersRouter.routes());
  app.use(usersRouter.allowedMethods());
  app.use(permissionsRouter.routes());
  app.use(permissionsRouter.allowedMethods());

  return app;
}
