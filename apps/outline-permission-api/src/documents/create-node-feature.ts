import {
  createOutlineHttpClient,
  getDocumentSummary,
  listChildDocuments,
  listCollectionDocuments,
  listUserMembershipDocuments,
  OutlineForbiddenError,
  OutlineNotFoundError,
  refreshAccessToken,
  type OutlineHttpClient,
} from "@hd-document/outline-api-client";
import type Router from "@koa/router";
import type pg from "pg";
import type { EnvironmentConfig } from "../config/environment-config.ts";
import { createPublicRouteProtectionMiddlewares } from "../http/public-route-protection-middleware.ts";
import { createExpiredRowsCleanup, type ExpiredRowsCleanup } from "../maintenance/expired-rows-cleanup-job.ts";
import { createGetOutlineAccessTokenForUser } from "../outline-oauth/get-outline-access-token-for-user.ts";
import { createRevokeUserOutlineGrant, type RevokeUserOutlineGrant } from "../outline-oauth/revoke-user-outline-grant.ts";
import { createTokenSealer } from "../outline-oauth/seal-and-unseal-token.ts";
import { createUserOutlineGrantRepository } from "../outline-oauth/user-outline-grant-repository.ts";
import { createCompletePendingRequestAfterConsent } from "../pending/complete-pending-request-after-consent.ts";
import { createPendingDocumentRequestRepository } from "../pending/pending-document-request-repository.ts";
import { registerPendingDocumentRoutes } from "../pending/pending-document-request-routes.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import { registerDocumentTreeRoutes } from "../document-tree/document-tree-routes.ts";
import {
  createLoadProjectDocumentTreeService,
  TREE_READ_OUTLINE_SCOPE,
} from "../document-tree/load-project-document-tree-service.ts";
import { createCreateDocumentAsUserService } from "./create-document-as-user-service.ts";
import { createAssertParentInCollection, createOutlineDocumentWithUserToken } from "./create-outline-document-with-user-token.ts";
import { createIdempotencyKeyRepository } from "./idempotency-key-repository.ts";
import { registerCreateDocumentRoutes } from "./create-document-routes.ts";

/** Scope tùy chỉnh trong env có thể thiếu `read`: thiếu thì user đồng ý xong vẫn bị đòi đồng ý lại ở API cây. */
const withScope = (scope: string, required: string): string =>
  scope.split(/[\s,]+/).includes(required) ? scope : `${scope} ${required}`;

/**
 * Ráp API tạo node với tác giả là user thật (phase 5). Trả undefined khi thiếu
 * cấu hình OAuth/niêm phong: các route không tồn tại, phần còn lại của service
 * chạy bình thường (deactivate không có grant nào để thu hồi).
 */
export function createNodeFeature(input: {
  config: EnvironmentConfig;
  pool: pg.Pool;
  adminClient: OutlineHttpClient;
  erpUserRepository: ErpUserRepository;
  mapRepository: ProjectCollectionMapRepository;
}):
  | {
      /** Route trình duyệt, gắn TRƯỚC middleware service key. */
      registerPublicRoutes: (router: Router) => void;
      /** Route `POST /documents`, gắn SAU middleware service key + scope `documents:create`. */
      registerServiceRoutes: (router: Router) => void;
      /** Route `GET /projects/:projectKey/document-tree`, gắn SAU middleware service key + scope `tree:read`. */
      registerTreeRoutes: (router: Router) => void;
      revokeUserGrant: RevokeUserOutlineGrant;
      /** Dọn dòng hết hạn; app đặt vào job định kỳ. */
      cleanup: ExpiredRowsCleanup;
    }
  | undefined {
  const { config, pool, adminClient, erpUserRepository, mapRepository } = input;
  const {
    PERMISSION_API_PUBLIC_URL: publicUrl,
    OUTLINE_OAUTH_CLIENT_ID: clientId,
    OUTLINE_OAUTH_CLIENT_SECRET: clientSecret,
    TOKEN_SEAL_PASSWORD: sealPassword,
  } = config;
  if (!publicUrl || !clientId || !clientSecret || !sealPassword) return undefined;

  const outlineBaseUrl = config.OUTLINE_INTERNAL_URL ?? config.OUTLINE_URL;
  const credentials = { baseUrl: outlineBaseUrl, clientId, clientSecret };
  const createUserClient = (token: string) => createOutlineHttpClient({ baseUrl: outlineBaseUrl, token });

  const assertParentInCollection = createAssertParentInCollection(adminClient);
  const idempotencyRepository = createIdempotencyKeyRepository(pool);
  const grantRepository = createUserOutlineGrantRepository(pool, createTokenSealer(sealPassword));
  const pendingRepository = createPendingDocumentRequestRepository(pool);
  const getAccessToken = createGetOutlineAccessTokenForUser({
    grantRepository,
    refresh: (refreshToken) => refreshAccessToken(credentials, refreshToken),
  });
  const createDocumentWithUserToken = createOutlineDocumentWithUserToken({
    adminClient,
    assertParentInCollection,
    createUserClient,
    outlineUrl: config.OUTLINE_URL,
  });
  const service = createCreateDocumentAsUserService({
    erpUserRepository,
    mapRepository,
    idempotencyRepository,
    pendingRepository,
    grantRepository,
    getAccessToken,
    createDocumentWithUserToken,
    assertParentInCollection,
    publicUrl,
    pendingTtlDays: config.PENDING_REQUEST_TTL_DAYS,
  });
  const treeService = createLoadProjectDocumentTreeService({
    erpUserRepository,
    mapRepository,
    pendingRepository,
    grantRepository,
    getAccessToken,
    listCollectionDocumentsWithUserToken: (accessToken, collectionId) =>
      listCollectionDocuments(createUserClient(accessToken), collectionId),
    sharedDocumentsSourceWithUserToken: (accessToken) => {
      const userClient = createUserClient(accessToken);
      return {
        listSharedRoots: () => listUserMembershipDocuments(userClient),
        listChildren: (parentDocumentId) => listChildDocuments(userClient, parentDocumentId),
        getDocument: async (documentId) => {
          try {
            return await getDocumentSummary(userClient, documentId);
          } catch (error) {
            if (error instanceof OutlineForbiddenError || error instanceof OutlineNotFoundError) return undefined;
            throw error;
          }
        },
      };
    },
    outlineUrl: config.OUTLINE_URL,
    publicUrl,
    pendingTtlDays: config.PENDING_REQUEST_TTL_DAYS,
  });
  const completeAfterConsent = createCompletePendingRequestAfterConsent({
    pendingRepository,
    erpUserRepository,
    mapRepository,
    grantRepository,
    credentials,
    redirectUri: `${publicUrl}/oauth/outline/callback`,
    createUserClient,
    createDocumentWithUserToken,
  });

  return {
    registerPublicRoutes: (router) => {
      // Chỉ 2 route trình duyệt (không đụng /healthz); phải đăng ký trước route.
      router.use(["/pending/:id", "/oauth/outline/callback"], ...createPublicRouteProtectionMiddlewares());
      registerPendingDocumentRoutes(router, {
        pendingRepository,
        completeAfterConsent,
        outlineUrl: config.OUTLINE_URL,
        publicUrl,
        oauthClientId: clientId,
        oauthScope: withScope(config.OUTLINE_OAUTH_SCOPE, TREE_READ_OUTLINE_SCOPE),
        erpPortalUrl: config.ERP_PORTAL_URL,
      });
    },
    registerServiceRoutes: (router) => registerCreateDocumentRoutes(router, { service }),
    registerTreeRoutes: (router) => registerDocumentTreeRoutes(router, { service: treeService }),
    cleanup: createExpiredRowsCleanup({
      pendingRepository,
      idempotencyRepository,
      pendingTtlDays: config.PENDING_REQUEST_TTL_DAYS,
    }),
    revokeUserGrant: createRevokeUserOutlineGrant({ grantRepository, credentials }),
  };
}
