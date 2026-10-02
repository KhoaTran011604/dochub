import { describe, expect, it } from "vitest";
import { computeLockedUntil } from "./login-rate-limiter-and-lockout.ts";

const MINUTE = 60_000;
const now = new Date("2026-10-02T12:00:00Z");

/** `count` lần sai, lần gần nhất cách `now` đúng `lastFailureMinutesAgo` phút. */
const failures = (count: number, lastFailureMinutesAgo: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      new Date(now.getTime() - (lastFailureMinutesAgo + index) * MINUTE),
  );

describe("computeLockedUntil", () => {
  it("does not lock below 5 failures", () => {
    expect(computeLockedUntil([], now)).toBeUndefined();
    expect(computeLockedUntil(failures(4, 0), now)).toBeUndefined();
  });

  it("locks for 15 minutes on the 5th failure", () => {
    expect(computeLockedUntil(failures(5, 1), now)).toEqual(
      new Date(now.getTime() + 14 * MINUTE),
    );
  });

  it("releases the lock once the 15 minutes have passed", () => {
    expect(computeLockedUntil(failures(5, 16), now)).toBeUndefined();
  });

  it("allows 4 more attempts after a lock expires before locking again", () => {
    expect(computeLockedUntil(failures(6, 0), now)).toBeUndefined();
    expect(computeLockedUntil(failures(9, 0), now)).toBeUndefined();
  });

  it("doubles the lock on each further 5 failures: 30 minutes, then 1 hour", () => {
    expect(computeLockedUntil(failures(10, 0), now)).toEqual(
      new Date(now.getTime() + 30 * MINUTE),
    );
    expect(computeLockedUntil(failures(15, 0), now)).toEqual(
      new Date(now.getTime() + 60 * MINUTE),
    );
  });

  it("caps the lock at 8 hours", () => {
    expect(computeLockedUntil(failures(100, 0), now)).toEqual(
      new Date(now.getTime() + 8 * 60 * MINUTE),
    );
  });

  it("ignores failures older than 24 hours", () => {
    const stale = Array.from(
      { length: 5 },
      (_, index) => new Date(now.getTime() - (25 * 60 + index) * MINUTE),
    );

    expect(computeLockedUntil(stale, now)).toBeUndefined();
    expect(
      computeLockedUntil([...stale, ...failures(4, 0)], now),
    ).toBeUndefined();
  });
});
