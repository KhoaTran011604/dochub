import { describe, expect, it } from "vitest";
import { buildErpSsoStartUrl, renderLoginPage } from "./login-page-view.ts";

const model = {
  interactionUid: "uid-1",
  csrfToken: "csrf-1",
  outlineUrl: "http://localhost:3000",
  showError: false,
};

describe("buildErpSsoStartUrl", () => {
  it("points at /sso/start of the ERP portal with Outline as returnTo", () => {
    expect(
      buildErpSsoStartUrl("http://localhost:4000", "http://localhost:3000"),
    ).toBe("http://localhost:4000/sso/start?returnTo=http%3A%2F%2Flocalhost%3A3000");
  });

  it("keeps a base path of the ERP portal", () => {
    expect(buildErpSsoStartUrl("https://erp.example.com/portal", "http://o")).toBe(
      "https://erp.example.com/portal/sso/start?returnTo=http%3A%2F%2Fo",
    );
  });

  it("is undefined without ERP_PORTAL_URL", () => {
    expect(buildErpSsoStartUrl(undefined, "http://localhost:3000")).toBeUndefined();
  });
});

describe("renderLoginPage", () => {
  it("shows the ERP SSO button when the portal URL is configured", () => {
    const html = renderLoginPage({ ...model, erpPortalUrl: "http://localhost:4000" });
    expect(html).toContain(
      'href="http://localhost:4000/sso/start?returnTo=http%3A%2F%2Flocalhost%3A3000"',
    );
    expect(html).toContain("Đăng nhập qua ERP");
  });

  it("falls back to a plain hint without the portal URL", () => {
    const html = renderLoginPage({ ...model, erpPortalUrl: undefined });
    expect(html).not.toContain("Đăng nhập qua ERP");
    expect(html).toContain("Người dùng ERP: mở tài liệu từ ERP");
  });

  it("escapes the portal URL", () => {
    const html = renderLoginPage({
      ...model,
      erpPortalUrl: 'http://localhost:4000/"><script>',
    });
    expect(html).not.toContain("<script>");
  });
});
