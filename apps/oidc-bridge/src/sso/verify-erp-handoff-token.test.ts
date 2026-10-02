import { generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  verifyErpHandoffToken,
  type HandoffTokenPolicy,
} from "./verify-erp-handoff-token.ts";

const policy: HandoffTokenPolicy = {
  issuer: "erp",
  audience: "hd-document-sso",
  algorithms: ["ES256"],
  maxLifetimeSeconds: 120,
};

let erpPrivateKey: CryptoKey;
let erpPublicKey: CryptoKey;

beforeAll(async () => {
  ({ privateKey: erpPrivateKey, publicKey: erpPublicKey } =
    await generateKeyPair("ES256"));
});

interface TokenOverrides {
  issuer?: string;
  audience?: string;
  subject?: string | null;
  jti?: string | null;
  issuedAt?: number;
  lifetimeSeconds?: number;
  key?: CryptoKey | Uint8Array;
  algorithm?: string;
}

function signToken(overrides: TokenOverrides = {}): Promise<string> {
  const issuedAt = overrides.issuedAt ?? Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: overrides.algorithm ?? "ES256", typ: "JWT" })
    .setIssuer(overrides.issuer ?? policy.issuer)
    .setAudience(overrides.audience ?? policy.audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + (overrides.lifetimeSeconds ?? 60));
  if (overrides.subject !== null) jwt.setSubject(overrides.subject ?? "user-1");
  if (overrides.jti !== null) jwt.setJti(overrides.jti ?? "jti-1");
  return jwt.sign(overrides.key ?? erpPrivateKey);
}

const verify = (token: string | undefined) =>
  verifyErpHandoffToken(token, erpPublicKey, policy);

describe("verifyErpHandoffToken", () => {
  it("accepts a valid token and returns only sub, jti and expiry", async () => {
    const result = await verify(
      await signToken({ subject: "user-42", jti: "abc" }),
    );

    expect(result).toMatchObject({
      ok: true,
      token: { erpUserId: "user-42", jti: "abc" },
    });
  });

  it("rejects a missing token", async () => {
    expect(await verify(undefined)).toEqual({
      ok: false,
      reason: "token_missing",
    });
    expect(await verify("")).toEqual({ ok: false, reason: "token_missing" });
  });

  it("rejects a token signed by another key", async () => {
    const { privateKey: attackerKey } = await generateKeyPair("ES256");

    expect(await verify(await signToken({ key: attackerKey }))).toEqual({
      ok: false,
      reason: "token_signature_invalid",
    });
  });

  it("rejects a tampered payload", async () => {
    const [header, , signature] = (await signToken()).split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        iss: policy.issuer,
        aud: policy.audience,
        sub: "admin",
        jti: "x",
      }),
    ).toString("base64url");

    expect(await verify(`${header}.${forgedPayload}.${signature}`)).toEqual({
      ok: false,
      reason: "token_signature_invalid",
    });
  });

  it("rejects an expired token (beyond the 30s clock tolerance)", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 200;

    expect(
      await verify(await signToken({ issuedAt, lifetimeSeconds: 60 })),
    ).toEqual({
      ok: false,
      reason: "token_expired",
    });
  });

  it("rejects a wrong audience or issuer", async () => {
    expect(await verify(await signToken({ audience: "another-app" }))).toEqual({
      ok: false,
      reason: "token_claims_invalid",
    });
    expect(await verify(await signToken({ issuer: "another-erp" }))).toEqual({
      ok: false,
      reason: "token_claims_invalid",
    });
  });

  it("rejects a lifetime longer than the configured maximum", async () => {
    expect(await verify(await signToken({ lifetimeSeconds: 3600 }))).toEqual({
      ok: false,
      reason: "token_lifetime_too_long",
    });
  });

  it("rejects a token issued in the future", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) + 600;

    expect((await verify(await signToken({ issuedAt }))).ok).toBe(false);
  });

  it("rejects tokens without sub or jti", async () => {
    expect(await verify(await signToken({ subject: null }))).toEqual({
      ok: false,
      reason: "token_claims_invalid",
    });
    expect(await verify(await signToken({ jti: null }))).toEqual({
      ok: false,
      reason: "token_claims_invalid",
    });
  });

  it("rejects symmetric and unsigned algorithms", async () => {
    const hmacToken = await signToken({
      algorithm: "HS256",
      key: new TextEncoder().encode(
        "shared-secret-shared-secret-shared-secret",
      ),
    });
    const unsignedToken = [
      Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
        "base64url",
      ),
      Buffer.from(
        JSON.stringify({
          iss: policy.issuer,
          aud: policy.audience,
          sub: "user-1",
          jti: "jti-1",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 60,
        }),
      ).toString("base64url"),
      "",
    ].join(".");

    expect((await verify(hmacToken)).ok).toBe(false);
    expect((await verify(unsignedToken)).ok).toBe(false);
  });

  it("rejects an asymmetric algorithm that is not in the allow-list", async () => {
    const { privateKey: rsaPrivateKey, publicKey: rsaPublicKey } =
      await generateKeyPair("RS256");
    const token = await signToken({ algorithm: "RS256", key: rsaPrivateKey });

    expect(await verifyErpHandoffToken(token, rsaPublicKey, policy)).toEqual({
      ok: false,
      reason: "token_signature_invalid",
    });
  });

  it("rejects garbage and oversized input without throwing", async () => {
    expect(await verify("not-a-jwt")).toEqual({
      ok: false,
      reason: "token_malformed",
    });
    expect(await verify("a".repeat(5000))).toEqual({
      ok: false,
      reason: "token_malformed",
    });
  });

  it("reports an unreachable key source separately from a bad token", async () => {
    const failingKeySource = () =>
      Promise.reject(new TypeError("fetch failed"));

    expect(
      await verifyErpHandoffToken(await signToken(), failingKeySource, policy),
    ).toEqual({
      ok: false,
      reason: "erp_key_unavailable",
    });
  });
});
