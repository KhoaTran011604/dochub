import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ERP_REFERRER,
  integrationDatabaseAvailable,
  startBridgeTestHarness,
  type BridgeTestHarness,
} from "../test-support/bridge-test-harness.ts";
import type { CookieJarTestBrowser } from "../test-support/cookie-jar-test-browser.ts";

// Outline cứ vài phút gọi lại /me bằng access token lưu lúc đăng nhập; nhận 401
// là thu mọi phiên của user. Token vì vậy phải sống độc lập với session bridge.
// Cần Postgres thật đã migrate: đặt APP_DATABASE_URL (owner) + BRIDGE_DATABASE_URL (bridge_app).
describe.skipIf(!integrationDatabaseAvailable)(
  "access token Outline keeps after login (real Postgres)",
  () => {
    let bridge: BridgeTestHarness;

    beforeAll(async () => {
      bridge = await startBridgeTestHarness();
    });
    afterAll(async () => {
      await bridge?.stop();
    });

    const signInErpUser = async (browser: CookieJarTestBrowser) => {
      const erpUserId = await bridge.seedErpUser();
      await browser.get(
        bridge.ssoUrl(await bridge.signHandoffToken(erpUserId)),
        { referer: ERP_REFERRER },
      );
      const login = await browser.get(bridge.authorizationUrl());
      return {
        erpUserId,
        accessToken: await bridge.exchangeCodeForAccessToken(login.url),
      };
    };

    it("stays valid after the bridge session is ended by a logout", async () => {
      const browser = bridge.newBrowser();
      const { erpUserId, accessToken } = await signInErpUser(browser);

      const logoutPage = await browser.get(`${bridge.baseUrl}/session/end`);
      const xsrf = /name="xsrf" value="([^"]+)"/.exec(logoutPage.body)?.[1];
      expect(xsrf).toBeTruthy();
      await browser.postForm(`${bridge.baseUrl}/session/end/confirm`, {
        xsrf: xsrf ?? "",
        logout: "yes",
      });
      // Session bridge đã hết: /auth quay lại form đăng nhập.
      expect((await browser.get(bridge.authorizationUrl())).status).toBe(200);

      const userinfo = await bridge.fetchUserinfo(accessToken);
      expect(userinfo.status).toBe(200);
      expect(userinfo.claims.sub).toBe(`erp:${erpUserId}`);
    });

    it("stays valid across a bridge restart", async () => {
      const { accessToken } = await signInErpUser(bridge.newBrowser());

      await bridge.restart();

      expect((await bridge.fetchUserinfo(accessToken)).status).toBe(200);
    });

    it("is refused with 401 once the ERP user is deactivated", async () => {
      const { erpUserId, accessToken } = await signInErpUser(
        bridge.newBrowser(),
      );
      expect((await bridge.fetchUserinfo(accessToken)).status).toBe(200);

      await bridge.ownerPool.query(
        `UPDATE permission_api.erp_users SET status = 'deactivated' WHERE erp_user_id = $1`,
        [erpUserId],
      );

      expect((await bridge.fetchUserinfo(accessToken)).status).toBe(401);
    });

    it("refuses an unknown or missing token", async () => {
      expect((await bridge.fetchUserinfo("not-a-real-token")).status).toBe(401);
    });
  },
);
