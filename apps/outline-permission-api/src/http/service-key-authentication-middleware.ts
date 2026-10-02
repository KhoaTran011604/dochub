import type { Middleware } from "koa";
import { parseServiceKey, secretMatchesHash } from "../service-clients/service-key-hashing.ts";
import type { ServiceClientRepository } from "../service-clients/service-client-repository.ts";
import { forbidden, unauthorized } from "./api-error.ts";

export interface AuthenticatedServiceClient {
  id: string;
  name: string;
  scopes: string[];
  projectKeys: string[];
}

/** Đọc `ctx.state.serviceClient` gán bởi middleware này (chạy sau nó trong chain). */
export function getServiceClient(state: Record<string, unknown>): AuthenticatedServiceClient {
  const client = state.serviceClient as AuthenticatedServiceClient | undefined;
  if (!client) {
    throw new Error("serviceClient missing from state: route mounted without auth middleware?");
  }
  return client;
}

/**
 * `Authorization: Bearer hdk_<clientId>_<secret>` → so băm hằng thời gian với
 * `service_clients.key_hash`. Không phân biệt "key sai dạng" / "clientId lạ" /
 * "secret sai" trong thông báo lỗi để không lộ thông tin dò key.
 */
export function createServiceKeyAuthenticationMiddleware(
  repository: ServiceClientRepository,
): Middleware {
  return async (ctx, next) => {
    const header = ctx.get("authorization");
    const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) {
      throw unauthorized("MISSING_SERVICE_KEY", "Missing Authorization: Bearer <service key> header.");
    }
    const parsed = parseServiceKey(bearer);
    if (!parsed) {
      throw unauthorized("INVALID_SERVICE_KEY", "Service key is invalid or revoked.");
    }
    const record = await repository.findActiveById(parsed.clientId);
    if (!record || !secretMatchesHash(parsed.secret, record.keyHash)) {
      throw unauthorized("INVALID_SERVICE_KEY", "Service key is invalid or revoked.");
    }
    ctx.state.serviceClient = {
      id: record.id,
      name: record.name,
      scopes: record.scopes,
      projectKeys: record.projectKeys,
    } satisfies AuthenticatedServiceClient;
    await next();
  };
}

/** Middleware chặn route theo scope (`users:write`, `permissions:write`, ...). */
export function requireScope(scope: string): Middleware {
  return async (ctx, next) => {
    const client = getServiceClient(ctx.state);
    if (!client.scopes.includes(scope)) {
      throw forbidden("SCOPE_FORBIDDEN", `Service key is missing required scope "${scope}".`);
    }
    await next();
  };
}

/** Service key có phạm vi `*` (mọi dự án) hoặc phải chứa đúng `projectKey`. */
export function assertProjectKeyAllowed(client: AuthenticatedServiceClient, projectKey: string): void {
  if (client.projectKeys.includes("*") || client.projectKeys.includes(projectKey)) return;
  throw forbidden("PROJECT_KEY_FORBIDDEN", `Service key is not scoped to project "${projectKey}".`);
}
