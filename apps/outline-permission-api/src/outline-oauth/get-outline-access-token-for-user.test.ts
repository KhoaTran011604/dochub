import { OutlineOAuthError } from "@hd-document/outline-api-client";
import { describe, expect, it, vi } from "vitest";
import { createGetOutlineAccessTokenForUser } from "./get-outline-access-token-for-user.ts";
import type { LockedGrantHandle, UserOutlineGrant, UserOutlineGrantRepository } from "./user-outline-grant-repository.ts";

function fakeGrantRepository() {
  const grants = new Map<string, UserOutlineGrant>();
  let capturedWork: (grant: UserOutlineGrant | undefined, handle: LockedGrantHandle) => Promise<unknown> = () =>
    Promise.reject(new Error("no work captured"));

  const repository: UserOutlineGrantRepository = {
    upsert: vi.fn(),
    delete: vi.fn(),
    async withLockedGrant(erpUserId, work) {
      capturedWork = work;
      const grant = grants.get(erpUserId);
      const handle: LockedGrantHandle = {
        async save(updated) {
          grants.set(erpUserId, updated);
        },
        async remove() {
          grants.delete(erpUserId);
        },
      };
      return work(grant, handle);
    },
  };
  return { repository, grants, capturedWork };
}

describe("createGetOutlineAccessTokenForUser", () => {
  it("returns undefined when no grant exists", async () => {
    const { repository } = fakeGrantRepository();
    const refresh = vi.fn();
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh });

    const token = await service("erp-user-1");

    expect(token).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns undefined without refresh or delete when the grant lacks the required scope", async () => {
    const { repository, grants } = fakeGrantRepository();
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "valid-token",
      refreshToken: "refresh-123",
      accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
      scope: "documents:create auth:read",
    });
    const refresh = vi.fn();
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh });

    expect(await service("erp-user-1", "read")).toBeUndefined();
    expect(await service("erp-user-1", "auth:read")).toBe("valid-token");
    expect(refresh).not.toHaveBeenCalled();
    expect(grants.has("erp-user-1")).toBe(true);
  });

  it("returns valid access token without refresh when not expired", async () => {
    const { repository, grants } = fakeGrantRepository();
    const now = new Date("2024-01-15T12:00:00Z");
    const expiresAt = new Date("2024-01-15T13:00:00Z"); // 1 hour in the future
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "valid-token",
      refreshToken: "refresh-123",
      accessTokenExpiresAt: expiresAt,
      scope: "read write",
    });
    const refresh = vi.fn();
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh, now: () => now });

    const token = await service("erp-user-1");

    expect(token).toBe("valid-token");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes token and returns new one when expired", async () => {
    const { repository, grants } = fakeGrantRepository();
    const now = new Date("2024-01-15T12:00:00Z");
    const expiresAt = new Date("2024-01-15T12:00:00Z"); // already expired
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "old-token",
      refreshToken: "refresh-old",
      accessTokenExpiresAt: expiresAt,
      scope: "read write",
    });
    const newExpiresAt = new Date("2024-01-15T13:30:00Z");
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "new-token",
      refreshToken: "refresh-new",
      expiresAt: newExpiresAt,
      scope: "read write",
    });
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh, now: () => now });

    const token = await service("erp-user-1");

    expect(token).toBe("new-token");
    expect(refresh).toHaveBeenCalledWith("refresh-old");
    expect(grants.get("erp-user-1")).toEqual({
      erpUserId: "erp-user-1",
      accessToken: "new-token",
      refreshToken: "refresh-new",
      accessTokenExpiresAt: newExpiresAt,
      scope: "read write",
    });
  });

  it("respects expiry skew and refreshes if expiring soon", async () => {
    const { repository, grants } = fakeGrantRepository();
    const now = new Date("2024-01-15T12:00:00Z");
    const expiresAt = new Date("2024-01-15T12:00:30Z"); // 30 seconds in future (less than 60s skew)
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "almost-expired",
      refreshToken: "refresh-123",
      accessTokenExpiresAt: expiresAt,
      scope: "read",
    });
    const newExpiresAt = new Date("2024-01-15T13:00:00Z");
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "refreshed-token",
      refreshToken: "refresh-new",
      expiresAt: newExpiresAt,
      scope: "read",
    });
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh, now: () => now });

    const token = await service("erp-user-1");

    expect(token).toBe("refreshed-token");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("removes grant and returns undefined on invalid_grant error", async () => {
    const { repository, grants } = fakeGrantRepository();
    const now = new Date("2024-01-15T12:00:00Z");
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "old-token",
      refreshToken: "refresh-revoked",
      accessTokenExpiresAt: new Date("2024-01-15T12:00:00Z"),
      scope: "read",
    });
    const refresh = vi.fn().mockRejectedValue(new OutlineOAuthError("invalid refresh token", 400, "invalid_grant"));
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh, now: () => now });

    const token = await service("erp-user-1");

    expect(token).toBeUndefined();
    expect(grants.has("erp-user-1")).toBe(false);
  });

  it("rethrows non-invalid_grant errors without deleting grant", async () => {
    const { repository, grants } = fakeGrantRepository();
    const now = new Date("2024-01-15T12:00:00Z");
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "old-token",
      refreshToken: "refresh-123",
      accessTokenExpiresAt: new Date("2024-01-15T12:00:00Z"),
      scope: "read",
    });
    const networkError = new OutlineOAuthError("network error", 0, undefined);
    const refresh = vi.fn().mockRejectedValue(networkError);
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh, now: () => now });

    await expect(service("erp-user-1")).rejects.toThrow(networkError);
    expect(grants.has("erp-user-1")).toBe(true);
  });

  it("concurrent calls both get refreshed token successfully", async () => {
    const { repository, grants } = fakeGrantRepository();
    const now = new Date("2024-01-15T12:00:00Z");
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "old-token",
      refreshToken: "refresh-123",
      accessTokenExpiresAt: new Date("2024-01-15T12:00:00Z"),
      scope: "read",
    });

    const refresh = vi.fn(async () => {
      // Simulate realistic async behavior
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        accessToken: "new-token",
        refreshToken: "refresh-new",
        expiresAt: new Date("2024-01-15T13:00:00Z"),
        scope: "read",
      };
    });

    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh, now: () => now });

    // Both concurrent calls get the same refreshed token
    const [result1, result2] = await Promise.all([service("erp-user-1"), service("erp-user-1")]);

    expect(result1).toBe("new-token");
    expect(result2).toBe("new-token");
    // Note: In a real database with locking, only 1 refresh would occur
    // Unit test verifies both calls complete successfully; integration tests verify the locking
  });

  it("handles other OAuth errors by rethrowing", async () => {
    const { repository, grants } = fakeGrantRepository();
    const now = new Date("2024-01-15T12:00:00Z");
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "old-token",
      refreshToken: "refresh-123",
      accessTokenExpiresAt: new Date("2024-01-15T12:00:00Z"),
      scope: "read",
    });
    const serverError = new OutlineOAuthError("server error", 500, undefined);
    const refresh = vi.fn().mockRejectedValue(serverError);
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh, now: () => now });

    await expect(service("erp-user-1")).rejects.toThrow(serverError);
    expect(grants.get("erp-user-1")).toBeDefined();
  });

  it("preserves scope when scope not in refresh response", async () => {
    const { repository, grants } = fakeGrantRepository();
    const now = new Date("2024-01-15T12:00:00Z");
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "old-token",
      refreshToken: "refresh-123",
      accessTokenExpiresAt: new Date("2024-01-15T12:00:00Z"),
      scope: "read write admin",
    });
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "new-token",
      refreshToken: "refresh-new",
      expiresAt: new Date("2024-01-15T13:00:00Z"),
      scope: "", // empty scope from server
    });
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh, now: () => now });

    await service("erp-user-1");

    expect(grants.get("erp-user-1")?.scope).toBe("read write admin"); // preserved old scope
  });

  it("uses new scope when refresh response includes it", async () => {
    const { repository, grants } = fakeGrantRepository();
    const now = new Date("2024-01-15T12:00:00Z");
    grants.set("erp-user-1", {
      erpUserId: "erp-user-1",
      accessToken: "old-token",
      refreshToken: "refresh-123",
      accessTokenExpiresAt: new Date("2024-01-15T12:00:00Z"),
      scope: "read write",
    });
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "new-token",
      refreshToken: "refresh-new",
      expiresAt: new Date("2024-01-15T13:00:00Z"),
      scope: "read only", // new scope
    });
    const service = createGetOutlineAccessTokenForUser({ grantRepository: repository, refresh, now: () => now });

    await service("erp-user-1");

    expect(grants.get("erp-user-1")?.scope).toBe("read only");
  });
});
