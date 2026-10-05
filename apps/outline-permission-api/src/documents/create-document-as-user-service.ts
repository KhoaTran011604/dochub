import { OutlineUnauthorizedError } from "@hd-document/outline-api-client";
import { createHash, randomUUID } from "node:crypto";
import { ApiError, conflict, forbidden, notFound } from "../http/api-error.ts";
import type { GetOutlineAccessTokenForUser } from "../outline-oauth/get-outline-access-token-for-user.ts";
import type { UserOutlineGrantRepository } from "../outline-oauth/user-outline-grant-repository.ts";
import type {
  PendingDocumentPayload,
  PendingDocumentRequestRepository,
} from "../pending/pending-document-request-repository.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import type { AssertParentInCollection, CreateOutlineDocumentWithUserToken } from "./create-outline-document-with-user-token.ts";
import type { IdempotencyKeyRepository } from "./idempotency-key-repository.ts";

export interface CreateDocumentInput extends PendingDocumentPayload {
  actingErpUserId: string;
}

export interface CreateDocumentResult {
  status: 201 | 202;
  body: Record<string, unknown>;
  /** Id doc đã/sẽ tạo (cho audit); không nằm trong body 202. */
  documentId: string;
}

export interface CreateDocumentAsUserService {
  create(serviceClientId: string, idempotencyKey: string, input: CreateDocumentInput): Promise<CreateDocumentResult>;
}

/** Băm body theo thứ tự field cố định: cùng nội dung → cùng hash, bất kể ERP sắp xếp key thế nào. */
export function hashCreateDocumentRequest(input: CreateDocumentInput): string {
  const canonical = JSON.stringify([
    input.projectKey,
    input.actingErpUserId,
    input.title,
    input.text,
    input.parentDocumentId ?? null,
    input.publish,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

const toPayload = ({ actingErpUserId: _acting, ...payload }: CreateDocumentInput): PendingDocumentPayload => payload;

export function createCreateDocumentAsUserService(deps: {
  erpUserRepository: ErpUserRepository;
  mapRepository: ProjectCollectionMapRepository;
  idempotencyRepository: IdempotencyKeyRepository;
  pendingRepository: PendingDocumentRequestRepository;
  grantRepository: UserOutlineGrantRepository;
  getAccessToken: GetOutlineAccessTokenForUser;
  createDocumentWithUserToken: CreateOutlineDocumentWithUserToken;
  /** Kiểm node cha thuộc collection của project TRƯỚC khi trả 202. */
  assertParentInCollection: AssertParentInCollection;
  /** `PERMISSION_API_PUBLIC_URL`: gốc của pendingUrl. */
  publicUrl: string;
  pendingTtlDays: number;
  now?: () => Date;
}): CreateDocumentAsUserService {
  const now = deps.now ?? (() => new Date());

  /** Gọi lại cùng key khi trước đó trả 202: xong rồi → 201, hết hạn → 410, còn chờ → 202 cũ. */
  async function replayPending(
    serviceClientId: string,
    key: string,
    stored: Record<string, unknown>,
    documentId: string,
  ): Promise<CreateDocumentResult> {
    const pending = await deps.pendingRepository.findByIdempotencyKey(serviceClientId, key);
    if (pending?.status === "completed" && pending.documentUrl) {
      const body = { documentId: pending.documentId, url: pending.documentUrl };
      await deps.idempotencyRepository.complete(serviceClientId, key, 201, body);
      return { status: 201, body, documentId: pending.documentId };
    }
    if (!pending || pending.expiresAt.getTime() <= now().getTime()) {
      throw new ApiError(410, "PENDING_REQUEST_EXPIRED", "The pending request expired; retry with a new Idempotency-Key.");
    }
    return { status: 202, body: stored, documentId };
  }

  async function createPending(
    serviceClientId: string,
    key: string,
    input: CreateDocumentInput,
    documentId: string,
  ): Promise<CreateDocumentResult> {
    const expiresAt = new Date(now().getTime() + deps.pendingTtlDays * 86_400_000);
    const pending = await deps.pendingRepository.create({
      serviceClientId,
      idempotencyKey: key,
      erpUserId: input.actingErpUserId,
      payload: toPayload(input),
      documentId,
      expiresAt,
    });
    const body = {
      requestId: pending.id,
      pendingUrl: `${deps.publicUrl}/pending/${pending.id}`,
      expiresAt: pending.expiresAt.toISOString(),
    };
    await deps.idempotencyRepository.complete(serviceClientId, key, 202, body);
    return { status: 202, body, documentId };
  }

  /** Validate + tạo doc hoặc 202. Mọi ApiError < 500 ở đây là lỗi validate, không có gì được tạo. */
  async function process(
    serviceClientId: string,
    key: string,
    input: CreateDocumentInput,
    documentId: string,
  ): Promise<CreateDocumentResult> {
    const user = await deps.erpUserRepository.findByErpUserId(input.actingErpUserId);
    if (!user) throw notFound("USER_NOT_FOUND", `No ERP user "${input.actingErpUserId}".`);
    if (user.status !== "active") throw forbidden("USER_DEACTIVATED", "The acting user is deactivated.");
    const map = await deps.mapRepository.findByProjectKey(input.projectKey);
    if (!map) throw notFound("PROJECT_NOT_FOUND", `No project "${input.projectKey}".`);

    const accessToken = await deps.getAccessToken(user.erpUserId);
    if (accessToken) {
      try {
        const created = await deps.createDocumentWithUserToken({
          accessToken,
          collectionId: map.collectionId,
          documentId,
          payload: toPayload(input),
        });
        await deps.idempotencyRepository.complete(serviceClientId, key, 201, created as unknown as Record<string, unknown>);
        return { status: 201, body: { ...created }, documentId: created.documentId };
      } catch (error) {
        // Outline từ chối token (bị thu hồi phía Outline): bỏ grant, user đồng ý lại.
        if (!(error instanceof OutlineUnauthorizedError)) throw error;
        await deps.grantRepository.delete(user.erpUserId);
      }
    }
    // Báo lỗi node cha ngay (không để user đồng ý xong mới thấy lỗi).
    if (input.parentDocumentId) await deps.assertParentInCollection(input.parentDocumentId, map.collectionId);
    return createPending(serviceClientId, key, input, documentId);
  }

  return {
    async create(serviceClientId, key, input) {
      const requestHash = hashCreateDocumentRequest(input);
      const record = await deps.idempotencyRepository.begin(serviceClientId, key, requestHash, randomUUID());
      if (record.requestHash !== requestHash) {
        throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key was already used with a different request body.");
      }
      if (record.responseStatus === 201 && record.responseBody) {
        const documentId = typeof record.responseBody.documentId === "string" ? record.responseBody.documentId : record.documentId;
        return { status: 201, body: record.responseBody, documentId };
      }
      if (record.responseStatus === 202 && record.responseBody) {
        return replayPending(serviceClientId, key, record.responseBody, record.documentId);
      }

      try {
        return await process(serviceClientId, key, input, record.documentId);
      } catch (error) {
        // Lỗi validate (4xx): xóa dòng chưa hoàn tất để retry cùng key sau khi sửa không bị kẹt.
        if (error instanceof ApiError && error.status < 500) {
          await deps.idempotencyRepository.discardUnfinished(serviceClientId, key).catch(() => undefined);
        }
        throw error;
      }
    },
  };
}
