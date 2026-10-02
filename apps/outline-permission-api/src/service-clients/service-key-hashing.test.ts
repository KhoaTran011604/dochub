import { describe, expect, it } from "vitest";
import {
  generateServiceKey,
  parseServiceKey,
  rotateServiceKey,
  secretMatchesHash,
} from "./service-key-hashing.ts";

describe("service-key-hashing", () => {
  it("generates a key that round-trips through parse + hash match", () => {
    const generated = generateServiceKey();
    const parsed = parseServiceKey(generated.fullKey);

    expect(parsed).toEqual({ clientId: generated.clientId, secret: parsed?.secret });
    expect(secretMatchesHash(parsed?.secret ?? "", generated.keyHash)).toBe(true);
  });

  it("rejects a tampered secret", () => {
    const generated = generateServiceKey();
    expect(secretMatchesHash("0".repeat(64), generated.keyHash)).toBe(false);
  });

  it("rejects malformed keys", () => {
    expect(parseServiceKey("not-a-key")).toBeUndefined();
    expect(parseServiceKey("hdk_short_short")).toBeUndefined();
    expect(parseServiceKey("other_prefix_" + "0".repeat(64))).toBeUndefined();
  });

  it("rotate keeps the same clientId but changes the secret/hash", () => {
    const generated = generateServiceKey();
    const rotated = rotateServiceKey(generated.clientId);

    expect(rotated.clientId).toBe(generated.clientId);
    expect(rotated.keyHash).not.toBe(generated.keyHash);
    expect(secretMatchesHash(parseServiceKey(generated.fullKey)?.secret ?? "", rotated.keyHash)).toBe(
      false,
    );
  });
});
