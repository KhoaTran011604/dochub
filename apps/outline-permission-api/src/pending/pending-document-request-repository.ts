import { randomBytes } from "node:crypto";
import type pg from "pg";

/** Nội dung doc cần tạo khi user đồng ý (đã qua validate ở route POST /documents). */
export interface PendingDocumentPayload {
  projectKey: string;
  title: string;
  text: string;
  parentDocumentId?: string | undefined;
  publish: boolean;
}

export interface PendingDocumentRequest {
  id: string;
  erpUserId: string;
  /** null = yêu cầu chỉ xin đồng ý (không có doc để tạo). */
  payload: PendingDocumentPayload | null;
  documentId: string | null;
  status: "pending" | "completed";
  documentUrl: string | null;
  expiresAt: Date;
}

interface PendingRow {
  id: string;
  erp_user_id: string;
  payload: PendingDocumentPayload | null;
  document_id: string | null;
  status: string;
  document_url: string | null;
  expires_at: Date;
}

function toRecord(row: PendingRow): PendingDocumentRequest {
  return {
    id: row.id,
    erpUserId: row.erp_user_id,
    payload: row.payload,
    documentId: row.document_id,
    status: row.status === "completed" ? "completed" : "pending",
    documentUrl: row.document_url,
    expiresAt: row.expires_at,
  };
}

export interface PendingDocumentRequestRepository {
  /** Idempotent theo (serviceClientId, key): gọi lại trả dòng đã có. */
  create(input: {
    serviceClientId: string;
    idempotencyKey: string;
    erpUserId: string;
    payload: PendingDocumentPayload;
    documentId: string;
    expiresAt: Date;
  }): Promise<PendingDocumentRequest>;
  /**
   * Yêu cầu chỉ xin đồng ý, 1 dòng cho mỗi user (gọi lại làm mới hạn + mở lại
   * nếu đã hoàn tất, giữ nguyên id để link cũ vẫn dùng được).
   */
  createConsentOnly(input: { serviceClientId: string; erpUserId: string; expiresAt: Date }): Promise<PendingDocumentRequest>;
  findById(id: string): Promise<PendingDocumentRequest | undefined>;
  findByIdempotencyKey(serviceClientId: string, key: string): Promise<PendingDocumentRequest | undefined>;
  /** Ghi state + PKCE verifier mới cho 1 lượt đồng ý (ghi đè lượt trước chưa dùng). */
  startAuthorization(id: string, state: string, codeVerifier: string): Promise<void>;
  /** Dùng `state` đúng 1 lần: trả yêu cầu + verifier rồi xóa state; null nếu state lạ/đã dùng. */
  claimByState(state: string): Promise<{ request: PendingDocumentRequest; codeVerifier: string } | undefined>;
  markCompleted(id: string, documentUrl: string | null): Promise<void>;
  /** Dọn yêu cầu đã hoàn tất hoặc đã hết hạn từ trước `cutoff`; trả số dòng đã xóa. */
  deleteFinishedBefore(cutoff: Date): Promise<number>;
}

const SELECT_COLUMNS = "id, erp_user_id, payload, document_id, status, document_url, expires_at";

export function createPendingDocumentRequestRepository(pool: pg.Pool): PendingDocumentRequestRepository {
  async function findOne(where: string, params: unknown[]): Promise<PendingDocumentRequest | undefined> {
    const result = await pool.query<PendingRow>(
      `SELECT ${SELECT_COLUMNS} FROM permission_api.pending_document_requests WHERE ${where}`,
      params,
    );
    const row = result.rows[0];
    return row ? toRecord(row) : undefined;
  }

  return {
    async create(input) {
      // requestId 128 bit ngẫu nhiên; chính nó là bí mật nằm trong pendingUrl.
      const id = randomBytes(16).toString("base64url");
      await pool.query(
        `INSERT INTO permission_api.pending_document_requests
           (id, service_client_id, idempotency_key, erp_user_id, payload, document_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (service_client_id, idempotency_key) DO NOTHING`,
        [id, input.serviceClientId, input.idempotencyKey, input.erpUserId, JSON.stringify(input.payload), input.documentId, input.expiresAt],
      );
      const created = await findOne("service_client_id = $1 AND idempotency_key = $2", [
        input.serviceClientId,
        input.idempotencyKey,
      ]);
      if (!created) throw new Error("pending_document_requests row missing after insert");
      return created;
    },

    async createConsentOnly(input) {
      const key = `consent:${input.erpUserId}`;
      const id = randomBytes(16).toString("base64url");
      await pool.query(
        `INSERT INTO permission_api.pending_document_requests
           (id, service_client_id, idempotency_key, erp_user_id, payload, document_id, expires_at)
         VALUES ($1, $2, $3, $4, NULL, NULL, $5)
         ON CONFLICT (service_client_id, idempotency_key) DO UPDATE SET
           status = 'pending', document_url = NULL, completed_at = NULL, expires_at = EXCLUDED.expires_at
         WHERE permission_api.pending_document_requests.payload IS NULL`,
        [id, input.serviceClientId, key, input.erpUserId, input.expiresAt],
      );
      const created = await findOne("service_client_id = $1 AND idempotency_key = $2", [input.serviceClientId, key]);
      if (!created) throw new Error("pending_document_requests row missing after insert");
      return created;
    },

    findById: (id) => findOne("id = $1", [id]),

    findByIdempotencyKey: (serviceClientId, key) =>
      findOne("service_client_id = $1 AND idempotency_key = $2", [serviceClientId, key]),

    async startAuthorization(id, state, codeVerifier) {
      await pool.query(
        `UPDATE permission_api.pending_document_requests
         SET oauth_state = $2, oauth_code_verifier = $3 WHERE id = $1 AND status = 'pending'`,
        [id, state, codeVerifier],
      );
    },

    async claimByState(state) {
      const result = await pool.query<PendingRow & { oauth_code_verifier: string | null }>(
        // CTE giữ khóa dòng và đọc verifier cũ trước khi UPDATE xóa nó.
        `WITH old AS (
           SELECT id, oauth_code_verifier FROM permission_api.pending_document_requests
           WHERE oauth_state = $1 AND status = 'pending' FOR UPDATE
         )
         UPDATE permission_api.pending_document_requests AS p
         SET oauth_state = NULL, oauth_code_verifier = NULL
         FROM old WHERE p.id = old.id
         RETURNING p.id, p.erp_user_id, p.payload, p.document_id, p.status, p.document_url, p.expires_at,
                   old.oauth_code_verifier`,
        [state],
      );
      const row = result.rows[0];
      if (!row?.oauth_code_verifier) return undefined;
      return { request: toRecord(row), codeVerifier: row.oauth_code_verifier };
    },

    async markCompleted(id, documentUrl) {
      await pool.query(
        `UPDATE permission_api.pending_document_requests
         SET status = 'completed', document_url = $2, completed_at = now() WHERE id = $1`,
        [id, documentUrl],
      );
    },

    async deleteFinishedBefore(cutoff) {
      const result = await pool.query(
        `DELETE FROM permission_api.pending_document_requests
         WHERE (status = 'completed' AND completed_at < $1) OR expires_at < $1`,
        [cutoff],
      );
      return result.rowCount ?? 0;
    },
  };
}
