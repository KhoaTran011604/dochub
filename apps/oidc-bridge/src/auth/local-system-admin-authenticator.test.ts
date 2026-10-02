import argon2 from "argon2";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createSystemAdminAuthenticator,
  type SystemAdminAuthenticator,
} from "./local-system-admin-authenticator.ts";

const PASSWORD = "correct horse battery staple 42";
let authenticate: SystemAdminAuthenticator;

beforeAll(async () => {
  authenticate = createSystemAdminAuthenticator({
    username: "system_admin",
    passwordHash: await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    }),
  });
});

describe("system admin authenticator", () => {
  it("accepts the right username and password", async () => {
    expect(await authenticate("system_admin", PASSWORD)).toBe(true);
  });

  it("ignores case and surrounding spaces in the username only", async () => {
    expect(await authenticate("  System_Admin ", PASSWORD)).toBe(true);
    expect(await authenticate("system_admin", ` ${PASSWORD}`)).toBe(false);
    expect(await authenticate("system_admin", PASSWORD.toUpperCase())).toBe(
      false,
    );
  });

  it("rejects a wrong password, a wrong username and empty input", async () => {
    expect(await authenticate("system_admin", "wrong")).toBe(false);
    expect(await authenticate("someone_else", PASSWORD)).toBe(false);
    expect(await authenticate("", "")).toBe(false);
  });

  it("treats an unusable stored hash as a failed login instead of throwing", async () => {
    const broken = createSystemAdminAuthenticator({
      username: "system_admin",
      passwordHash: "$argon2id$not-a-real-hash",
    });

    expect(await broken("system_admin", PASSWORD)).toBe(false);
  });
});
