import {
  OutlineBadRequestError,
  OutlineNetworkError,
  OutlineServerError,
  OutlineTimeoutError,
  OutlineForbiddenError,
  OutlineNotFoundError,
  OutlineUnauthorizedError,
  createDocument,
  getDocumentInfo,
  type OutlineHttpClient,
} from "@hd-document/outline-api-client";
import { ApiError, badRequest, forbidden, notFound } from "../http/api-error.ts";
import type { PendingDocumentPayload } from "../pending/pending-document-request-repository.ts";

export interface CreatedDocument {
  documentId: string;
  url: string;
}

export type CreateOutlineDocumentWithUserToken = (input: {
  accessToken: string;
  collectionId: string;
  documentId: string;
  payload: PendingDocumentPayload;
}) => Promise<CreatedDocument>;

export type AssertParentInCollection = (parentId: string, collectionId: string) => Promise<void>;

/** Lỗi Outline mà gọi lại cùng `id` có thể đã thành công ở lần trước (mất response, trùng id). */
const isMaybeAlreadyCreated = (error: unknown): boolean =>
  error instanceof OutlineBadRequestError ||
  error instanceof OutlineServerError ||
  error instanceof OutlineTimeoutError ||
  error instanceof OutlineNetworkError;

/** Kiểm `parentDocumentId` thuộc collection của project bằng client admin (user có thể không đọc được node cha). */
export function createAssertParentInCollection(adminClient: OutlineHttpClient): AssertParentInCollection {
  return async (parentId, collectionId) => {
    try {
      const parent = await getDocumentInfo(adminClient, parentId);
      if (parent.collectionId !== collectionId) {
        throw badRequest("PARENT_DOCUMENT_WRONG_PROJECT", "parentDocumentId does not belong to the project's collection.");
      }
    } catch (error) {
      if (error instanceof OutlineNotFoundError) {
        throw notFound("PARENT_DOCUMENT_NOT_FOUND", `No document "${parentId}".`);
      }
      // 401 của admin token là lỗi cấu hình, không được lẫn với 401 của token user (sẽ xóa grant).
      if (error instanceof OutlineUnauthorizedError) {
        throw new ApiError(502, "OUTLINE_ADMIN_UNAUTHORIZED", "Outline rejected the service admin token.");
      }
      throw error;
    }
  };
}

/**
 * Lõi tạo doc bằng token của user thật, dùng chung cho nhánh 201 và callback
 * đồng ý. `documentId` đã sinh sẵn: nếu lần trước đã tạo xong mà mất response,
 * `documents.info` theo id trả lại doc đó thay vì tạo trùng.
 */
export function createOutlineDocumentWithUserToken(deps: {
  /** Client admin: chỉ để tra doc theo id do ta sinh khi `documents.create` báo trùng id. */
  adminClient: OutlineHttpClient;
  assertParentInCollection: AssertParentInCollection;
  createUserClient: (accessToken: string) => OutlineHttpClient;
  /** `OUTLINE_URL` public để ghép `url` trả cho ERP. */
  outlineUrl: string;
}): CreateOutlineDocumentWithUserToken {
  const toResult = (documentId: string, url: string | undefined): CreatedDocument => ({
    documentId,
    url: `${deps.outlineUrl}${url ?? `/doc/${documentId}`}`,
  });

  return async ({ accessToken, collectionId, documentId, payload }) => {
    if (payload.parentDocumentId) await deps.assertParentInCollection(payload.parentDocumentId, collectionId);
    const userClient = deps.createUserClient(accessToken);
    try {
      const created = await createDocument(userClient, {
        id: documentId,
        title: payload.title,
        text: payload.text,
        collectionId,
        ...(payload.parentDocumentId ? { parentDocumentId: payload.parentDocumentId } : {}),
        publish: payload.publish,
      });
      return toResult(created.id, created.url);
    } catch (error) {
      if (isMaybeAlreadyCreated(error)) {
        // Request song song cùng id: bản kia có thể chưa commit, chờ ngắn rồi tra lại.
        for (let attempt = 0; attempt < 4; attempt++) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400));
          // Admin đọc được mọi doc; id do ta sinh nên không lộ gì. (Token user có thể bị Forbidden lúc bản kia chưa gán quyền xong.)
          const existing = await getDocumentInfo(deps.adminClient, documentId).catch(() => undefined);
          if (existing) return toResult(existing.id, existing.url);
        }
      }
      if (error instanceof OutlineForbiddenError || error instanceof OutlineNotFoundError) {
        throw forbidden("ACTING_USER_FORBIDDEN", "The acting user is not allowed to create documents in this project.");
      }
      throw error;
    }
  };
}
