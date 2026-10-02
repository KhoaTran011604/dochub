import { describe, expect, it } from "vitest";
import { validBridgeEnvironment } from "../test-support/valid-bridge-environment.ts";
import { loadEnvironmentConfig } from "./environment-config.ts";

const load = (overrides: Record<string, string | undefined> = {}) =>
  loadEnvironmentConfig(validBridgeEnvironment(overrides));

describe("loadEnvironmentConfig", () => {
  it("parses a valid environment and applies defaults", () => {
    const config = load();

    expect(config.PORT).toBe(4001);
    expect(config.ERP_SSO_AUDIENCE).toBe("hd-document-sso");
    expect(config.ERP_SSO_ALGORITHMS).toEqual(["ES256"]);
    expect(config.SSO_TOKEN_MAX_LIFETIME_SECONDS).toBe(120);
    expect(config.SSO_REQUIRE_REFERRER).toBe(true);
    expect(config.TRUST_PROXY).toBe(false);
  });

  it("normalizes URLs, origins, lists and escaped PEM newlines", () => {
    const config = load({
      OUTLINE_URL: "https://docs.example.com/",
      SSO_ALLOWED_REFERRER_ORIGINS:
        "https://erp.example.com/portal , https://erp2.example.com",
      BRIDGE_COOKIE_KEYS: `${"a".repeat(32)}, ${"b".repeat(32)}`,
    });

    expect(config.OUTLINE_URL).toBe("https://docs.example.com");
    expect(config.SSO_ALLOWED_REFERRER_ORIGINS).toEqual([
      "https://erp.example.com",
      "https://erp2.example.com",
    ]);
    expect(config.BRIDGE_COOKIE_KEYS).toEqual(["a".repeat(32), "b".repeat(32)]);
    expect(config.ERP_SSO_PUBLIC_KEY_PEM).toContain(
      "-----BEGIN PUBLIC KEY-----\nAAAA\n",
    );
  });

  it("treats empty optional variables (as compose passes them) as unset", () => {
    const config = load({
      ERP_SSO_JWKS_URL: "",
      ERP_PORTAL_URL: "",
      PERMISSION_API_PUBLIC_URL: "",
    });

    expect(config.ERP_SSO_JWKS_URL).toBeUndefined();
    expect(config.ERP_PORTAL_URL).toBeUndefined();
    expect(config.PERMISSION_API_PUBLIC_URL).toBeUndefined();
  });

  it("requires at least one ERP key source", () => {
    expect(() => load({ ERP_SSO_PUBLIC_KEY_PEM: undefined })).toThrow(
      /ERP_SSO_JWKS_URL/,
    );
    expect(() =>
      load({
        ERP_SSO_PUBLIC_KEY_PEM: undefined,
        ERP_SSO_JWKS_URL: "https://erp.example.com/.well-known/jwks.json",
      }),
    ).not.toThrow();
  });

  it("accepts an upstream IdP instead of an ERP key source", () => {
    const config = load({
      ERP_SSO_PUBLIC_KEY_PEM: undefined,
      ERP_SSO_ISSUER: undefined,
      SSO_ALLOWED_REFERRER_ORIGINS: "",
      UPSTREAM_OIDC_ISSUER_URL: "https://idp.example.com/",
      UPSTREAM_OIDC_CLIENT_ID: "hd-dochub",
    });

    expect(config.UPSTREAM_OIDC_ISSUER_URL).toBe("https://idp.example.com");
    expect(config.UPSTREAM_OIDC_CLIENT_SECRET).toBeUndefined();
    expect(config.UPSTREAM_OIDC_SCOPES).toBe("openid profile email");
  });

  it("requires a client id with the upstream issuer, and an ERP issuer with an ERP key", () => {
    expect(() =>
      load({ UPSTREAM_OIDC_ISSUER_URL: "https://idp.example.com" }),
    ).toThrow(/UPSTREAM_OIDC_CLIENT_ID/);
    expect(() => load({ ERP_SSO_ISSUER: undefined })).toThrow(
      /ERP_SSO_ISSUER/,
    );
  });

  it("refuses an http upstream issuer in production", () => {
    const upstream = {
      UPSTREAM_OIDC_ISSUER_URL: "http://idp.example.com",
      UPSTREAM_OIDC_CLIENT_ID: "hd-dochub",
    };
    expect(() => load({ ...upstream, NODE_ENV: "production" })).toThrow(
      /UPSTREAM_OIDC_ISSUER_URL/,
    );
    expect(() => load(upstream)).not.toThrow();
  });

  it("only accepts asymmetric ERP algorithms", () => {
    expect(() => load({ ERP_SSO_ALGORITHMS: "HS256" })).toThrow(
      /ERP_SSO_ALGORITHMS/,
    );
    expect(() => load({ ERP_SSO_ALGORITHMS: "none" })).toThrow(
      /ERP_SSO_ALGORITHMS/,
    );
    expect(
      load({
        ERP_SSO_ALGORITHMS: "ES256,RS256",
        ERP_SSO_PUBLIC_KEY_PEM: undefined,
        ERP_SSO_JWKS_URL: "https://erp.example.com/jwks.json",
      }).ERP_SSO_ALGORITHMS,
    ).toEqual(["ES256", "RS256"]);
  });

  it("requires referrer origins unless the referrer check is switched off", () => {
    expect(() => load({ SSO_ALLOWED_REFERRER_ORIGINS: "" })).toThrow(
      /SSO_ALLOWED_REFERRER_ORIGINS/,
    );
    expect(() =>
      load({ SSO_ALLOWED_REFERRER_ORIGINS: "", SSO_REQUIRE_REFERRER: "false" }),
    ).not.toThrow();
  });

  it("rejects weak or malformed secrets", () => {
    expect(() => load({ BRIDGE_COOKIE_KEYS: "short" })).toThrow(
      /BRIDGE_COOKIE_KEYS/,
    );
    expect(() => load({ OIDC_CLIENT_SECRET: "short" })).toThrow(
      /OIDC_CLIENT_SECRET/,
    );
    expect(() => load({ BRIDGE_SIGNING_JWKS: "{not json" })).toThrow(
      /BRIDGE_SIGNING_JWKS/,
    );
    expect(() =>
      load({ SYSTEM_ADMIN_PASSWORD_HASH: "plaintext-password" }),
    ).toThrow(/SYSTEM_ADMIN_PASSWORD_HASH/);
  });

  it("names the variable but never echoes its value", () => {
    const secret = "plaintext-password-that-must-not-leak";

    expect(() => load({ SYSTEM_ADMIN_PASSWORD_HASH: secret })).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(secret) as string,
      }),
    );
  });
});
