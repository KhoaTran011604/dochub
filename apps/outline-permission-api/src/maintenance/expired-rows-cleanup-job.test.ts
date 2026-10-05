import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdempotencyKeyRepository } from "../documents/idempotency-key-repository.ts";
import type { PendingDocumentRequestRepository } from "../pending/pending-document-request-repository.ts";
import { createExpiredRowsCleanup, startExpiredRowsCleanupJob } from "./expired-rows-cleanup-job.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-10-05T00:00:00Z");

function fakes() {
  const pendingRepository = { deleteFinishedBefore: vi.fn(async (_cutoff: Date) => 3) } as unknown as PendingDocumentRequestRepository;
  const idempotencyRepository = { deleteCreatedBefore: vi.fn(async (_cutoff: Date) => 5) } as unknown as IdempotencyKeyRepository;
  return { pendingRepository, idempotencyRepository };
}

describe("createExpiredRowsCleanup", () => {
  it("uses 7-day pending and 30-day idempotency cutoffs", async () => {
    const f = fakes();
    const result = await createExpiredRowsCleanup({ ...f, pendingTtlDays: 7, now: () => NOW }).runOnce();
    expect(result).toEqual({ pendingRequests: 3, idempotencyKeys: 5 });
    expect(vi.mocked(f.pendingRepository.deleteFinishedBefore).mock.calls[0]![0].getTime()).toBe(NOW.getTime() - 7 * DAY);
    expect(vi.mocked(f.idempotencyRepository.deleteCreatedBefore).mock.calls[0]![0].getTime()).toBe(NOW.getTime() - 30 * DAY);
  });

  it("keeps idempotency rows longer than a long pending TTL", async () => {
    const f = fakes();
    await createExpiredRowsCleanup({ ...f, pendingTtlDays: 60, now: () => NOW }).runOnce();
    expect(vi.mocked(f.idempotencyRepository.deleteCreatedBefore).mock.calls[0]![0].getTime()).toBe(NOW.getTime() - 67 * DAY);
  });
});

describe("startExpiredRowsCleanupJob", () => {
  afterEach(() => vi.useRealTimers());

  it("runs at boot and every interval until stopped; errors are logged, not thrown", async () => {
    vi.useFakeTimers();
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce({ pendingRequests: 0, idempotencyKeys: 0 })
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue({ pendingRequests: 0, idempotencyKeys: 0 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stop = startExpiredRowsCleanupJob({ runOnce }, { intervalMs: 1000, log: () => undefined });
    expect(runOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith("expired rows cleanup failed:", "db down");
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOnce).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runOnce).toHaveBeenCalledTimes(3);
    errorSpy.mockRestore();
  });
});
