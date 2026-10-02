import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.ts";
import { assertProjectKeyAllowed, requireScope } from "./service-key-authentication-middleware.ts";

function fakeState(overrides: Partial<{ scopes: string[]; projectKeys: string[] }> = {}) {
  return {
    serviceClient: {
      id: "client-1",
      name: "erp",
      scopes: overrides.scopes ?? [],
      projectKeys: overrides.projectKeys ?? [],
    },
  };
}

describe("requireScope", () => {
  it("calls next() when the service client has the scope", async () => {
    const middleware = requireScope("users:write");
    let called = false;
    await middleware({ state: fakeState({ scopes: ["users:write"] }) } as never, () => {
      called = true;
      return Promise.resolve();
    });
    expect(called).toBe(true);
  });

  it("throws a 403 ApiError when the scope is missing", async () => {
    const middleware = requireScope("users:write");
    await expect(
      middleware({ state: fakeState({ scopes: ["permissions:write"] }) } as never, async () => {}),
    ).rejects.toMatchObject({ status: 403, code: "SCOPE_FORBIDDEN" } satisfies Partial<ApiError>);
  });
});

describe("assertProjectKeyAllowed", () => {
  const client = (projectKeys: string[]) => ({
    id: "client-1",
    name: "erp",
    scopes: [],
    projectKeys,
  });

  it("allows an exact projectKey match", () => {
    expect(() => assertProjectKeyAllowed(client(["acme-portal"]), "acme-portal")).not.toThrow();
  });

  it("allows any projectKey when scoped to *", () => {
    expect(() => assertProjectKeyAllowed(client(["*"]), "anything")).not.toThrow();
  });

  it("rejects a projectKey outside the service key's scope", () => {
    expect(() => assertProjectKeyAllowed(client(["other-project"]), "acme-portal")).toThrow(
      expect.objectContaining({ status: 403, code: "PROJECT_KEY_FORBIDDEN" }),
    );
  });
});
