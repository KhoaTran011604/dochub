import { exchangeAuthorizationCode, getAuthInfo, revokeOAuthToken } from "@hd-document/outline-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompletePendingRequestAfterConsent } from "./complete-pending-request-after-consent.ts";

vi.mock("@hd-document/outline-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hd-document/outline-api-client")>()),
  exchangeAuthorizationCode: vi.fn(),
  getAuthInfo: vi.fn(),
  revokeOAuthToken: vi.fn(async () => undefined),
}));

function build() {
  const upsert = vi.fn();
  const createDocumentWithUserToken = vi.fn(async () => ({ documentId: "d1", url: "https://o.test/doc/d1" }));
  const complete = createCompletePendingRequestAfterConsent({
    pendingRepository: {
      claimByState: async () => ({
        request: {
          id: "r1",
          erpUserId: "u1",
          payload: { projectKey: "p1", title: "t", text: "x", publish: true },
          documentId: "d1",
          status: "pending",
          documentUrl: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
        codeVerifier: "v",
      }),
      markCompleted: vi.fn(),
    } as never,
    erpUserRepository: {
      findByErpUserId: async () => ({ erpUserId: "u1", status: "active", outlineUserId: "outline-1" }),
    } as never,
    mapRepository: { findByProjectKey: async () => ({ collectionId: "c1" }) } as never,
    grantRepository: { upsert } as never,
    credentials: { baseUrl: "https://o.test", clientId: "i", clientSecret: "s" },
    redirectUri: "https://api.test/cb",
    createUserClient: () => ({}) as never,
    createDocumentWithUserToken,
  });
  return { complete, upsert, createDocumentWithUserToken };
}

describe("auth.info during consent callback", () => {
  beforeEach(() => {
    vi.mocked(revokeOAuthToken).mockClear();
    vi.mocked(exchangeAuthorizationCode).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(),
      scope: "read write",
    } as never);
  });

  it("network failure -> 503 OUTLINE_UNAVAILABLE, tokens NOT revoked, no grant saved", async () => {
    vi.mocked(getAuthInfo).mockRejectedValue(new Error("ECONNRESET"));
    const t = build();
    await expect(t.complete({ code: "c", state: "s", cookieState: "s" })).rejects.toMatchObject({
      status: 503,
      code: "OUTLINE_UNAVAILABLE",
    });
    expect(revokeOAuthToken).not.toHaveBeenCalled();
    expect(t.upsert).not.toHaveBeenCalled();
  });

  it("real user-id mismatch -> 403 WRONG_OUTLINE_USER and both tokens revoked", async () => {
    vi.mocked(getAuthInfo).mockResolvedValue({ user: { id: "someone-else" } } as never);
    const t = build();
    await expect(t.complete({ code: "c", state: "s", cookieState: "s" })).rejects.toMatchObject({
      status: 403,
      code: "WRONG_OUTLINE_USER",
    });
    expect(revokeOAuthToken).toHaveBeenCalledTimes(2);
    expect(t.upsert).not.toHaveBeenCalled();
  });
});
