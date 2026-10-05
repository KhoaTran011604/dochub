import {
  exchangeAuthorizationCode,
  getAuthInfo,
  revokeOAuthToken,
  type OutlineHttpClient,
  type OutlineOAuthCredentials,
} from "@hd-document/outline-api-client";
import { ApiError, badRequest, forbidden, notFound } from "../http/api-error.ts";
import type { CreateOutlineDocumentWithUserToken } from "../documents/create-outline-document-with-user-token.ts";
import type { UserOutlineGrantRepository } from "../outline-oauth/user-outline-grant-repository.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import type { PendingDocumentRequestRepository } from "./pending-document-request-repository.ts";

export type CompletePendingRequestAfterConsent = (input: {
  code: string;
  state: string;
  /** Giá trị cookie đặt lúc /pending/:id: chứng minh cùng trình duyệt đã bắt đầu luồng. */
  cookieState: string | undefined;
}) => Promise<string | undefined>;

/**
 * Callback sau khi user bấm Đồng ý: đổi code → kiểm danh tính → lưu grant →
 * tạo doc → trả URL doc để redirect (undefined = yêu cầu chỉ xin đồng ý). Mọi lỗi là ApiError (route đổi thành 1
 * dòng text). Thứ tự quan trọng: kiểm danh tính TRƯỚC khi lưu grant, để người
 * khác mở pendingUrl không gài được token của họ vào tài khoản của acting user.
 */
export function createCompletePendingRequestAfterConsent(deps: {
  pendingRepository: PendingDocumentRequestRepository;
  erpUserRepository: ErpUserRepository;
  mapRepository: ProjectCollectionMapRepository;
  grantRepository: UserOutlineGrantRepository;
  credentials: OutlineOAuthCredentials;
  redirectUri: string;
  createUserClient: (accessToken: string) => OutlineHttpClient;
  createDocumentWithUserToken: CreateOutlineDocumentWithUserToken;
  now?: () => Date;
}): CompletePendingRequestAfterConsent {
  const now = deps.now ?? (() => new Date());

  async function revokeQuietly(token: string): Promise<void> {
    await revokeOAuthToken(deps.credentials, token).catch(() => undefined);
  }

  return async ({ code, state, cookieState }) => {
    if (!cookieState || cookieState !== state) {
      throw badRequest("STATE_MISMATCH", "This link must be opened in the browser that started the consent.");
    }
    const claimed = await deps.pendingRepository.claimByState(state);
    if (!claimed) throw badRequest("STATE_INVALID", "This consent link was already used or is invalid. Open the pending link again.");
    const { request, codeVerifier } = claimed;
    if (request.expiresAt.getTime() <= now().getTime()) {
      throw new ApiError(410, "PENDING_REQUEST_EXPIRED", "This request expired.");
    }

    const user = await deps.erpUserRepository.findByErpUserId(request.erpUserId);
    if (!user || user.status !== "active" || !user.outlineUserId) {
      throw forbidden("USER_NOT_ALLOWED", "The user for this request is not active.");
    }

    const tokens = await exchangeAuthorizationCode(deps.credentials, {
      code,
      redirectUri: deps.redirectUri,
      codeVerifier,
    }).catch(() => {
      throw badRequest("CODE_EXCHANGE_FAILED", "Could not complete the consent. Open the pending link again.");
    });

    // Lỗi mạng/timeout/5xx khi hỏi danh tính KHÔNG phải sai user: không thu hồi
    // token, báo lỗi tạm thời để user mở lại pending link.
    const identity = await getAuthInfo(deps.createUserClient(tokens.accessToken)).catch(() => {
      throw new ApiError(503, "OUTLINE_UNAVAILABLE", "Could not verify your Outline identity right now. Open the pending link again shortly.");
    });
    if (identity.user.id.toLowerCase() !== user.outlineUserId.toLowerCase()) {
      await Promise.all([revokeQuietly(tokens.refreshToken), revokeQuietly(tokens.accessToken)]);
      throw forbidden("WRONG_OUTLINE_USER", "You are signed in to Outline as a different user than this request is for.");
    }
    await deps.grantRepository.upsert({
      erpUserId: user.erpUserId,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });

    // Yêu cầu chỉ xin đồng ý (API cây tài liệu): lưu grant là xong, không có doc để tạo.
    if (!request.payload || !request.documentId) {
      await deps.pendingRepository.markCompleted(request.id, null);
      return undefined;
    }

    const map = await deps.mapRepository.findByProjectKey(request.payload.projectKey);
    if (!map) throw notFound("PROJECT_NOT_FOUND", `No project "${request.payload.projectKey}".`);
    const created = await deps.createDocumentWithUserToken({
      accessToken: tokens.accessToken,
      collectionId: map.collectionId,
      documentId: request.documentId,
      payload: request.payload,
    });
    await deps.pendingRepository.markCompleted(request.id, created.url);
    return created.url;
  };
}
