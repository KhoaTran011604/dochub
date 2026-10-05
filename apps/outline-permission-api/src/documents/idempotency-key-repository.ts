import type pg from "pg";

export interface IdempotencyRecord {
  requestHash: string;
  /** Sinh trước khi gọi Outline, giữ nguyên qua mọi lần gọi lại cùng key. */
  documentId: string;
  /** null = chưa có kết quả cuối (đang xử lý hoặc sập giữa chừng). */
  responseStatus: number | null;
  responseBody: Record<string, unknown> | null;
}

interface IdempotencyRow {
  request_hash: string;
  document_id: string;
  response_status: number | null;
  response_body: Record<string, unknown> | null;
}

function toRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    requestHash: row.request_hash,
    documentId: row.document_id,
    responseStatus: row.response_status,
    responseBody: row.response_body,
  };
}

export interface IdempotencyKeyRepository {
  /** Tạo dòng mới với `documentId` đã sinh, hoặc trả dòng đã có của cùng key (không ghi đè). */
  begin(serviceClientId: string, key: string, requestHash: string, newDocumentId: string): Promise<IdempotencyRecord>;
  complete(serviceClientId: string, key: string, status: number, body: Record<string, unknown>): Promise<void>;
  /** Xóa dòng CHƯA có kết quả cuối (validate thất bại) để retry cùng key sau khi sửa không bị 409. */
  discardUnfinished(serviceClientId: string, key: string): Promise<void>;
  /** Dọn dòng tạo trước `cutoff`; trả số dòng đã xóa. */
  deleteCreatedBefore(cutoff: Date): Promise<number>;
}

const SELECT_COLUMNS = "request_hash, document_id, response_status, response_body";

export function createIdempotencyKeyRepository(pool: pg.Pool): IdempotencyKeyRepository {
  return {
    async begin(serviceClientId, key, requestHash, newDocumentId) {
      // DO UPDATE no-op để RETURNING luôn trả dòng (thắng hay thua race đều đọc được).
      const result = await pool.query<IdempotencyRow>(
        `INSERT INTO permission_api.idempotency_keys (service_client_id, key, request_hash, document_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (service_client_id, key) DO UPDATE SET key = EXCLUDED.key
         RETURNING ${SELECT_COLUMNS}`,
        [serviceClientId, key, requestHash, newDocumentId],
      );
      const row = result.rows[0];
      if (!row) throw new Error("idempotency begin did not return a row");
      return toRecord(row);
    },

    async complete(serviceClientId, key, status, body) {
      await pool.query(
        `UPDATE permission_api.idempotency_keys SET response_status = $3, response_body = $4
         WHERE service_client_id = $1 AND key = $2`,
        [serviceClientId, key, status, JSON.stringify(body)],
      );
    },

    async discardUnfinished(serviceClientId, key) {
      await pool.query(
        `DELETE FROM permission_api.idempotency_keys
         WHERE service_client_id = $1 AND key = $2 AND response_status IS NULL`,
        [serviceClientId, key],
      );
    },

    async deleteCreatedBefore(cutoff) {
      const result = await pool.query(`DELETE FROM permission_api.idempotency_keys WHERE created_at < $1`, [cutoff]);
      return result.rowCount ?? 0;
    },
  };
}
