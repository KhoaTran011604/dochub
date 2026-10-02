import { describe, expect, it } from "vitest";
import { validateReturnToUrl } from "./validate-return-to-url.ts";

const allowList = {
  outlineUrl: "https://docs.example.com",
  permissionApiPublicUrl: "https://docs-api.example.com",
};

const validate = (returnTo: string | undefined) =>
  validateReturnToUrl(returnTo, allowList);

describe("validateReturnToUrl", () => {
  it("defaults to the Outline root when returnTo is absent", () => {
    expect(validate(undefined)).toEqual({
      ok: true,
      url: "https://docs.example.com/",
    });
    expect(validate("")).toEqual({
      ok: true,
      url: "https://docs.example.com/",
    });
  });

  it("allows any path on the Outline origin", () => {
    expect(
      validate("https://docs.example.com/doc/hop-dong-abc123?x=1#h"),
    ).toEqual({
      ok: true,
      url: "https://docs.example.com/doc/hop-dong-abc123?x=1#h",
    });
  });

  it("allows only /pending/ paths on the permission API origin", () => {
    expect(validate("https://docs-api.example.com/pending/abc").ok).toBe(true);
    expect(validate("https://docs-api.example.com/api/v1/users")).toEqual({
      ok: false,
      reason: "return_to_not_allowed",
    });
    // `..` và `%2e%2e` được chuẩn hóa trước khi so path.
    expect(
      validate("https://docs-api.example.com/pending/../api/v1/users").ok,
    ).toBe(false);
    expect(
      validate("https://docs-api.example.com/pending/%2e%2e/api/v1/users").ok,
    ).toBe(false);
  });

  it.each([
    "https://evil.example/doc/x",
    "https://docs.example.com.evil.example/",
    "https://docs.example.com@evil.example/",
    "https://evil.example\\@docs.example.com/",
    "http://docs.example.com/", // khác scheme = khác origin
    "https://docs.example.com:8443/",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
  ])("rejects a foreign origin or scheme: %s", (returnTo) => {
    expect(validate(returnTo)).toEqual({
      ok: false,
      reason: "return_to_not_allowed",
    });
  });

  it("rejects credentials in the URL even on the Outline origin", () => {
    expect(validate("https://user:pass@docs.example.com/")).toEqual({
      ok: false,
      reason: "return_to_not_allowed",
    });
  });

  it.each(["//evil.example/x", "/doc/abc", "doc/abc", "not a url"])(
    "rejects relative or scheme-less input: %s",
    (returnTo) => {
      expect(validate(returnTo)).toEqual({
        ok: false,
        reason: "return_to_malformed",
      });
    },
  );

  it("ignores the permission API rule when that URL is not configured", () => {
    expect(
      validateReturnToUrl("https://docs-api.example.com/pending/abc", {
        outlineUrl: allowList.outlineUrl,
      }).ok,
    ).toBe(false);
  });
});
