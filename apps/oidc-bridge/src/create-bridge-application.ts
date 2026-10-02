import Router from "@koa/router";
import type Provider from "oidc-provider";
import type pg from "pg";
import { createPermissionApiAutoProvisioner } from "./accounts/erp-user-auto-provisioner.ts";
import { createErpUserDirectoryReader } from "./accounts/erp-user-directory-reader.ts";
import { createAuthAuditLogger } from "./audit/auth-audit-logger.ts";
import { createSystemAdminAuthenticator } from "./auth/local-system-admin-authenticator.ts";
import { createLoginRateLimiter } from "./auth/login-rate-limiter-and-lockout.ts";
import {
  isErpHandoffEnabled,
  type EnvironmentConfig,
} from "./config/environment-config.ts";
import { createHealthCheckRoute } from "./health/health-check-route.ts";
import { registerLoginInteractionRoutes } from "./interactions/login-interaction-routes.ts";
import { createFindAccount } from "./provider/find-account-and-claims.ts";
import { createOidcProvider } from "./provider/oidc-provider-configuration.ts";
import { resolveErpPublicKey } from "./sso/erp-public-key-resolver.ts";
import { createSsoHandoffRepository } from "./sso/sso-handoff-repository.ts";
import { createSsoHandoffRoute } from "./sso/sso-handoff-route.ts";
import {
  createRedirectToUpstreamLogin,
  registerUpstreamCallbackRoute,
  UPSTREAM_CALLBACK_PATH,
  type RedirectToUpstreamLogin,
} from "./upstream/upstream-login-routes.ts";
import { createUpstreamOidcClient } from "./upstream/upstream-oidc-client.ts";

/**
 * Ráp bridge: provider OIDC (chính nó là app Koa) + các route tự viết
 * (/sso, /interaction, /healthz). Không mở port, không tạo pool → test dùng lại được.
 */
export async function createBridgeApplication(
  config: EnvironmentConfig,
  pool: pg.Pool,
): Promise<Provider> {
  const audit = createAuthAuditLogger(pool);
  const readErpUser = createErpUserDirectoryReader(
    pool,
    config.SYSTEM_ADMIN_EMAIL,
  );
  const handoffs = createSsoHandoffRepository(pool);

  const provider = createOidcProvider(
    config,
    pool,
    createFindAccount(
      {
        username: config.SYSTEM_ADMIN_USERNAME,
        email: config.SYSTEM_ADMIN_EMAIL,
        displayName: config.SYSTEM_ADMIN_DISPLAY_NAME,
      },
      readErpUser,
    ),
  );

  // Log truy cập chỉ ghi path: query của /sso chứa token, của /auth chứa state.
  provider.use(async (ctx, next) => {
    const startedAt = Date.now();
    try {
      await next();
    } finally {
      if (ctx.path !== "/healthz") {
        console.log(
          `${ctx.method} ${ctx.path} ${ctx.status} ${Date.now() - startedAt}ms`,
        );
      }
    }
  });

  const router = new Router();
  router.get("/healthz", createHealthCheckRoute(pool));

  // Đường 1: handoff JWT của ERP (erp-fake / CLI dev). Config bảo đảm có ERP_SSO_ISSUER khi bật.
  if (isErpHandoffEnabled(config)) {
    router.get(
      "/sso",
      createSsoHandoffRoute({
        erpPublicKey: await resolveErpPublicKey({
          jwksUrl: config.ERP_SSO_JWKS_URL,
          publicKeyPem: config.ERP_SSO_PUBLIC_KEY_PEM,
          algorithms: config.ERP_SSO_ALGORITHMS,
        }),
        tokenPolicy: {
          issuer: config.ERP_SSO_ISSUER ?? "",
          audience: config.ERP_SSO_AUDIENCE,
          algorithms: config.ERP_SSO_ALGORITHMS,
          maxLifetimeSeconds: config.SSO_TOKEN_MAX_LIFETIME_SECONDS,
        },
        referrerPolicy: {
          required: config.SSO_REQUIRE_REFERRER,
          allowedOrigins: config.SSO_ALLOWED_REFERRER_ORIGINS,
        },
        returnToAllowList: {
          outlineUrl: config.OUTLINE_URL,
          permissionApiPublicUrl: config.PERMISSION_API_PUBLIC_URL,
        },
        handoffs,
        readErpUser,
        audit,
        erpPortalUrl: config.ERP_PORTAL_URL,
      }),
    );
  }

  // Đường 2: IdP OIDC thật. Thành công cũng đi qua handoff → cùng 1 chỗ hoàn tất đăng nhập.
  let redirectToUpstreamLogin: RedirectToUpstreamLogin | undefined;
  if (config.UPSTREAM_OIDC_ISSUER_URL && config.UPSTREAM_OIDC_CLIENT_ID) {
    const upstreamDeps = {
      upstream: createUpstreamOidcClient({
        issuerUrl: config.UPSTREAM_OIDC_ISSUER_URL,
        clientId: config.UPSTREAM_OIDC_CLIENT_ID,
        clientSecret: config.UPSTREAM_OIDC_CLIENT_SECRET,
        scopes: config.UPSTREAM_OIDC_SCOPES,
        redirectUri: `${config.BRIDGE_PUBLIC_URL}${UPSTREAM_CALLBACK_PATH}`,
      }),
      handoffs,
      readErpUser,
      // Config bảo đảm có INTERNAL_URL khi có SERVICE_KEY.
      autoProvision:
        config.PERMISSION_API_SERVICE_KEY && config.PERMISSION_API_INTERNAL_URL
          ? createPermissionApiAutoProvisioner({
              baseUrl: config.PERMISSION_API_INTERNAL_URL,
              serviceKey: config.PERMISSION_API_SERVICE_KEY,
            })
          : undefined,
      audit,
      erpPortalUrl: config.ERP_PORTAL_URL,
    };
    registerUpstreamCallbackRoute(router, upstreamDeps);
    redirectToUpstreamLogin = createRedirectToUpstreamLogin(upstreamDeps);
  }

  registerLoginInteractionRoutes(router, {
    provider,
    handoffs,
    readErpUser,
    authenticateSystemAdmin: createSystemAdminAuthenticator({
      username: config.SYSTEM_ADMIN_USERNAME,
      passwordHash: config.SYSTEM_ADMIN_PASSWORD_HASH,
    }),
    rateLimiter: createLoginRateLimiter(pool),
    audit,
    // Khóa đầu là khóa ký hiện hành (config bảo đảm có ít nhất 1).
    csrfSecret: config.BRIDGE_COOKIE_KEYS[0] ?? "",
    outlineOrigin: new URL(config.OUTLINE_URL).origin,
    erpPortalUrl: config.ERP_PORTAL_URL,
    redirectToUpstreamLogin,
  });

  // `provider.use` chèn middleware TRƯỚC handler của provider: route tự viết
  // khớp trước, còn lại (/auth, /token, /me, /jwks...) rơi xuống provider.
  provider.use(router.routes());
  return provider;
}
