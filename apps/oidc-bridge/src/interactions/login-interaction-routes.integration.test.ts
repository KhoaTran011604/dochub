import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_PASSWORD,
  ERP_REFERRER,
  integrationDatabaseAvailable,
  OUTLINE_URL,
  startBridgeTestHarness,
  type BridgeTestHarness,
} from "../test-support/bridge-test-harness.ts";
import type {
  BrowserResponse,
  CookieJarTestBrowser,
} from "../test-support/cookie-jar-test-browser.ts";

const csrfTokenIn = (html: string) =>
  /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";

// Cần Postgres thật đã migrate: đặt APP_DATABASE_URL (owner) + BRIDGE_DATABASE_URL (bridge_app).
describe.skipIf(!integrationDatabaseAvailable)(
  "system_admin login form (real Postgres)",
  () => {
    let bridge: BridgeTestHarness;

    beforeAll(async () => {
      bridge = await startBridgeTestHarness();
    });
    afterAll(async () => {
      // Bộ đếm lockout của test (mọi request đến từ loopback).
      await bridge?.ownerPool.query(
        `DELETE FROM bridge.login_attempts WHERE ip LIKE '%127.0.0.1'`,
      );
      await bridge?.stop();
    });

    const openLoginForm = async (browser: CookieJarTestBrowser) => {
      const form = await browser.get(bridge.authorizationUrl());
      expect(form.status).toBe(200);
      expect(form.url).toContain("/interaction/");
      return form;
    };

    const submit = (
      browser: CookieJarTestBrowser,
      form: BrowserResponse,
      fields: { username?: string; password: string; csrf?: string },
    ) =>
      browser.postForm(`${form.url}/login`, {
        csrf: fields.csrf ?? csrfTokenIn(form.body),
        username: fields.username ?? bridge.config.SYSTEM_ADMIN_USERNAME,
        password: fields.password,
      });

    it("shows the admin form with hardening headers when there is no handoff", async () => {
      const form = await openLoginForm(bridge.newBrowser());

      expect(form.body).toContain("Người dùng ERP: mở tài liệu từ ERP");
      expect(form.headers.get("cache-control")).toBe("no-store");
      expect(form.headers.get("x-frame-options")).toBe("DENY");
      expect(form.headers.get("content-security-policy")).toContain(
        "default-src 'none'",
      );
      expect(form.setCookies.join(";")).not.toMatch(/secure/i); // HTTP local; HTTPS do provider tự bật.
    });

    it("signs system_admin in with the right password and issues the admin claims", async () => {
      const browser = bridge.newBrowser();
      const form = await openLoginForm(browser);

      const wrong = await submit(browser, form, { password: "wrong-password" });
      expect(wrong.status).toBe(401);
      expect(wrong.body).toContain("Sai thông tin đăng nhập");

      const login = await submit(browser, form, { password: ADMIN_PASSWORD });
      expect(login.url).toContain(`${OUTLINE_URL}/auth/oidc.callback?code=`);
      expect(await bridge.exchangeCodeForClaims(login.url)).toEqual({
        sub: "local:system_admin",
        email: bridge.config.SYSTEM_ADMIN_EMAIL,
        email_verified: true,
        name: bridge.config.SYSTEM_ADMIN_DISPLAY_NAME,
        preferred_username: bridge.config.SYSTEM_ADMIN_USERNAME,
      });
    });

    it("rejects a login post without the form's CSRF token", async () => {
      const browser = bridge.newBrowser();
      const form = await openLoginForm(browser);

      const response = await submit(browser, form, {
        password: ADMIN_PASSWORD,
        csrf: "forged",
      });

      expect(response.status).toBe(400);
      expect(response.url).not.toContain("oidc.callback");
    });

    it("rejects a login post from a browser that does not own the interaction", async () => {
      const form = await openLoginForm(bridge.newBrowser());

      const response = await submit(bridge.newBrowser(), form, {
        password: ADMIN_PASSWORD,
      });

      expect(response.status).toBe(400);
    });

    it("lets a fresh ERP handoff win over an existing bridge session of another account", async () => {
      const browser = bridge.newBrowser();
      await submit(browser, await openLoginForm(browser), {
        password: ADMIN_PASSWORD,
      });
      // Phiên bridge của admin còn sống: /auth trả thẳng code cho admin.
      const asAdmin = await browser.get(bridge.authorizationUrl());
      expect((await bridge.exchangeCodeForClaims(asAdmin.url)).sub).toBe(
        "local:system_admin",
      );

      const erpUserId = await bridge.seedErpUser();
      await browser.get(
        bridge.ssoUrl(await bridge.signHandoffToken(erpUserId)),
        {
          referer: ERP_REFERRER,
        },
      );
      const asErpUser = await browser.get(bridge.authorizationUrl());

      expect((await bridge.exchangeCodeForClaims(asErpUser.url)).sub).toBe(
        `erp:${erpUserId}`,
      );
    });

    it("stops serving a user's claims once they are deactivated", async () => {
      const erpUserId = await bridge.seedErpUser();
      const browser = bridge.newBrowser();
      await browser.get(
        bridge.ssoUrl(await bridge.signHandoffToken(erpUserId)),
        {
          referer: ERP_REFERRER,
        },
      );
      const login = await browser.get(bridge.authorizationUrl());
      await bridge.ownerPool.query(
        `UPDATE permission_api.erp_users SET status = 'deactivated' WHERE erp_user_id = $1`,
        [erpUserId],
      );

      // Outline nhận lỗi thay vì claim → thu phiên của user.
      await expect(bridge.exchangeCodeForClaims(login.url)).rejects.toThrow(
        /token endpoint/,
      );
    });

    it("keeps an in-flight login working across a bridge restart", async () => {
      const browser = bridge.newBrowser();
      const form = await openLoginForm(browser);

      await bridge.restart();

      const login = await submit(browser, form, { password: ADMIN_PASSWORD });
      expect(login.url).toContain("oidc.callback?code=");
      expect((await bridge.exchangeCodeForClaims(login.url)).sub).toBe(
        "local:system_admin",
      );
    });

    it("locks the form after 5 wrong passwords, even for the right password", async () => {
      const browser = bridge.newBrowser();
      const form = await openLoginForm(browser);
      const username = `locked-${bridge.config.SYSTEM_ADMIN_USERNAME}`;

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        expect(
          (await submit(browser, form, { username, password: "wrong" })).status,
        ).toBe(401);
      }
      const locked = await submit(browser, form, {
        username,
        password: "wrong",
      });
      expect(locked.status).toBe(429);

      // Khóa theo (username, IP): username khác trên cùng IP vẫn đăng nhập được.
      const admin = await submit(browser, form, { password: ADMIN_PASSWORD });
      expect(admin.url).toContain("oidc.callback?code=");

      const audit = await bridge.ownerPool.query<{ reason: string }>(
        `SELECT detail->>'reason' AS reason FROM bridge.auth_audit_log
       WHERE event = 'admin_login' AND outcome = 'rejected' ORDER BY id DESC LIMIT 1`,
      );
      expect(audit.rows[0]?.reason).toBe("locked_out");
    });
  },
);
