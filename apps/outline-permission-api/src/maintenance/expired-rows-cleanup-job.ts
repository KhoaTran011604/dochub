import type { IdempotencyKeyRepository } from "../documents/idempotency-key-repository.ts";
import type { PendingDocumentRequestRepository } from "../pending/pending-document-request-repository.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Giữ yêu cầu pending đã hoàn tất/hết hạn thêm chừng này ngày (để ERP còn hỏi lại trạng thái). */
const PENDING_RETENTION_DAYS = 7;
const IDEMPOTENCY_MIN_RETENTION_DAYS = 30;

export interface ExpiredRowsCleanup {
  /** Chạy 1 lượt; trả số dòng đã xóa mỗi bảng. */
  runOnce(): Promise<{ pendingRequests: number; idempotencyKeys: number }>;
}

/**
 * Dọn dòng cũ: pending_document_requests (hoàn tất/hết hạn quá 7 ngày) và
 * idempotency_keys (cũ hơn max(30 ngày, TTL pending + 7 ngày) để không xóa
 * khóa của yêu cầu pending còn sống).
 */
export function createExpiredRowsCleanup(deps: {
  pendingRepository: PendingDocumentRequestRepository;
  idempotencyRepository: IdempotencyKeyRepository;
  pendingTtlDays: number;
  now?: () => Date;
}): ExpiredRowsCleanup {
  const now = deps.now ?? (() => new Date());
  const idempotencyRetentionDays = Math.max(IDEMPOTENCY_MIN_RETENTION_DAYS, deps.pendingTtlDays + PENDING_RETENTION_DAYS);
  return {
    async runOnce() {
      const at = now().getTime();
      const pendingRequests = await deps.pendingRepository.deleteFinishedBefore(
        new Date(at - PENDING_RETENTION_DAYS * DAY_MS),
      );
      const idempotencyKeys = await deps.idempotencyRepository.deleteCreatedBefore(
        new Date(at - idempotencyRetentionDays * DAY_MS),
      );
      return { pendingRequests, idempotencyKeys };
    },
  };
}

/**
 * Chạy `cleanup` ngay khi khởi động rồi mỗi giờ. Timer unref (không giữ process
 * sống); lỗi chỉ log. Trả hàm dừng cho shutdown.
 */
export function startExpiredRowsCleanupJob(
  cleanup: ExpiredRowsCleanup,
  options: { intervalMs?: number; log?: (message: string) => void } = {},
): () => void {
  const log = options.log ?? ((message: string) => console.log(message));
  const tick = async () => {
    try {
      const removed = await cleanup.runOnce();
      log(`expired rows cleanup: removed ${removed.pendingRequests} pending requests, ${removed.idempotencyKeys} idempotency keys`);
    } catch (error) {
      console.error("expired rows cleanup failed:", error instanceof Error ? error.message : error);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? HOUR_MS);
  timer.unref();
  return () => clearInterval(timer);
}
