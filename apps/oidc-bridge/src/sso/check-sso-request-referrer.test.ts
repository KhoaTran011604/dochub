import { describe, expect, it } from "vitest";
import { checkSsoRequestReferrer } from "./check-sso-request-referrer.ts";

const policy = { required: true, allowedOrigins: ["https://erp.example.com"] };

describe("checkSsoRequestReferrer", () => {
  it("accepts a referrer from an allowed ERP origin", () => {
    expect(
      checkSsoRequestReferrer("https://erp.example.com/projects/1", policy),
    ).toEqual({
      ok: true,
    });
    expect(checkSsoRequestReferrer("https://erp.example.com/", policy)).toEqual(
      { ok: true },
    );
  });

  it("rejects a missing referrer (link opened from mail, chat or the address bar)", () => {
    expect(checkSsoRequestReferrer(undefined, policy)).toEqual({
      ok: false,
      reason: "referrer_missing",
    });
  });

  it("rejects another origin and reports only its origin", () => {
    expect(
      checkSsoRequestReferrer("https://evil.example/page?secret=1", policy),
    ).toEqual({
      ok: false,
      reason: "referrer_not_allowed",
      origin: "https://evil.example",
    });
  });

  it("does not match by prefix or by a different scheme or port", () => {
    expect(
      checkSsoRequestReferrer("https://erp.example.com.evil.example/", policy)
        .ok,
    ).toBe(false);
    expect(checkSsoRequestReferrer("http://erp.example.com/", policy).ok).toBe(
      false,
    );
    expect(
      checkSsoRequestReferrer("https://erp.example.com:8443/", policy).ok,
    ).toBe(false);
  });

  it("rejects an unparseable referrer", () => {
    expect(checkSsoRequestReferrer("not a url", policy)).toEqual({
      ok: false,
      reason: "referrer_not_allowed",
    });
  });

  it("accepts anything when the check is disabled", () => {
    const disabled = { required: false, allowedOrigins: [] };

    expect(checkSsoRequestReferrer(undefined, disabled)).toEqual({ ok: true });
    expect(checkSsoRequestReferrer("https://evil.example/", disabled)).toEqual({
      ok: true,
    });
  });
});
