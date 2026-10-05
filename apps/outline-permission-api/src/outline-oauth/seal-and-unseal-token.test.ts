import { describe, expect, it } from "vitest";
import { createTokenSealer } from "./seal-and-unseal-token.ts";

const PASSWORD = "p".repeat(32);

describe("createTokenSealer", () => {
  it("round-trips a token and never stores it in plain text", async () => {
    const sealer = createTokenSealer(PASSWORD);
    const sealed = await sealer.seal("outline-refresh-token");
    expect(sealed).not.toContain("outline-refresh-token");
    expect(await sealer.unseal(sealed)).toBe("outline-refresh-token");
  });

  it("rejects a sealed value under a different password or after tampering", async () => {
    const sealed = await createTokenSealer(PASSWORD).seal("t");
    await expect(createTokenSealer("q".repeat(32)).unseal(sealed)).rejects.toThrow();
    await expect(createTokenSealer(PASSWORD).unseal(`${sealed}x`)).rejects.toThrow();
  });
});
