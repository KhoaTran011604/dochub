import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  integrationDatabaseAvailable,
  OUTLINE_URL,
  startBridgeTestHarness,
  type BridgeTestHarness,
} from "../test-support/bridge-test-harness.ts";
import { CookieJarTestBrowser } from "../test-support/cookie-jar-test-browser.ts";
import { FAKE_UPSTREAM_CLIENT_ID } from "../test-support/fake-upstream-idp-server.ts";

// Cần Postgres thật đã migrate: đặt APP_DATABASE_URL (owner) + BRIDGE_DATABASE_URL (bridge_app).
describe.skipIf(!integrationDatabaseAvailable)(
  "login through the upstream IdP (real Postgres)",
  () => {
    let bridge: BridgeTestHarness;
    const idp = () => {
      if (!bridge.fakeIdp) throw new Error("harness started without upstream");
      return bridge.fakeIdp;
    };

    beforeAll(async () => {
      bridge = await startBridgeTestHarness({
        upstream: true,
        autoProvision: true,
      });
    });
    afterAll(async () => {
      await bridge?.stop();
    });

    const lastUpstreamAudit = async () => {
      const result = await bridge.ownerPool.query<{
        outcome: string;
        reason: string | null;
        subject: string | null;
      }>(
        `SELECT outcome, detail->>'reason' AS reason, subject FROM bridge.auth_audit_log
         WHERE event = 'upstream_login' ORDER BY id DESC LIMIT 1`,
      );
      return result.rows[0];
    };

    /** Outline → bridge (trang đăng nhập) → nút SSO → IdP (tự đăng nhập `sub`) → URL callback của bridge. */
    const loginAtIdp = async (browser: CookieJarTestBrowser, sub: string) => {
      idp().currentSub = sub;
      const page = await browser.get(bridge.authorizationUrl());
      expect(page.status).toBe(200);
      expect(page.body).toContain(`href="${new URL(page.url).pathname}/upstream"`);
      const toIdp = await browser.get(`${page.url}/upstream`);
      expect(toIdp.url.startsWith(`${idp().issuerUrl}/auth?`)).toBe(true);

      // IdP là origin khác: cookie riêng, như trình duyệt thật.
      const idpBrowser = new CookieJarTestBrowser(idp().issuerUrl);
      const back = await idpBrowser.get(toIdp.url);
      expect(back.url.startsWith(`${bridge.baseUrl}/upstream/callback?`)).toBe(
        true,
      );
      return { authorizeUrl: new URL(toIdp.url), callbackUrl: back.url };
    };

    it("signs an ERP user in through the IdP with PKCE, state and nonce", async () => {
      const erpUserId = await bridge.seedErpUser();
      const browser = bridge.newBrowser();

      const { authorizeUrl, callbackUrl } = await loginAtIdp(browser, erpUserId);
      const params = authorizeUrl.searchParams;
      expect(params.get("client_id")).toBe(FAKE_UPSTREAM_CLIENT_ID);
      expect(params.get("redirect_uri")).toBe(
        `${bridge.baseUrl}/upstream/callback`,
      );
      expect(params.get("code_challenge_method")).toBe("S256");
      expect(params.get("code_challenge")).toBeTruthy();
      expect(params.get("state")).toBeTruthy();
      expect(params.get("nonce")).toBeTruthy();
      expect(params.get("scope")).toBe("openid profile email");

      const login = await browser.get(callbackUrl);
      expect(login.url).toContain(`${OUTLINE_URL}/auth/oidc.callback?code=`);
      // Hồ sơ từ erp_users, không phải từ IdP.
      expect(await bridge.exchangeCodeForClaims(login.url)).toMatchObject({
        sub: `erp:${erpUserId}`,
        email: `${erpUserId}@hd-document.test`,
        email_verified: true,
      });
      expect(await lastUpstreamAudit()).toMatchObject({
        outcome: "success",
        subject: `erp:${erpUserId}`,
      });
    });

    it("provisions a user the IdP knows but erp_users does not, through the permission API, then signs them in", async () => {
      const sub = `${bridge.runId}-first-login`;
      const browser = bridge.newBrowser();
      const { callbackUrl } = await loginAtIdp(browser, sub);

      const login = await browser.get(callbackUrl);

      expect(login.url).toContain(`${OUTLINE_URL}/auth/oidc.callback?code=`);
      // Email/tên lấy từ id_token của IdP giả, đi qua PUT /users/{sub}.
      expect(bridge.fakePermissionApi?.received.at(-1)).toEqual({
        erpUserId: sub,
        email: `${sub}@idp.test`,
        name: `IdP ${sub}`,
      });
      expect(await bridge.exchangeCodeForClaims(login.url)).toMatchObject({
        sub: `erp:${sub}`,
        email: `${sub}@idp.test`,
      });
      expect(await lastUpstreamAudit()).toMatchObject({
        outcome: "success",
        subject: `erp:${sub}`,
      });
    });

    it("refuses an unknown user when the permission API rejects the provision", async () => {
      const sub = `${bridge.runId}-rejected`;
      const browser = bridge.newBrowser();
      const { callbackUrl } = await loginAtIdp(browser, sub);
      const api = bridge.fakePermissionApi;
      if (!api) throw new Error("harness started without permission API");
      api.nextError = { status: 403, code: "SYSTEM_ADMIN_EMAIL_RESERVED" };

      const response = await browser.get(callbackUrl);

      expect(response.status).toBe(403);
      expect(response.body).toContain("chưa được cấp quyền");
      expect(await lastUpstreamAudit()).toMatchObject({
        outcome: "rejected",
        reason: "provision_rejected",
      });
    });

    it("rejects a callback whose state does not match the transaction", async () => {
      const erpUserId = await bridge.seedErpUser();
      const browser = bridge.newBrowser();
      const { callbackUrl } = await loginAtIdp(browser, erpUserId);
      const tampered = new URL(callbackUrl);
      tampered.searchParams.set("state", "forged-state");

      const response = await browser.get(tampered.href);

      expect(response.status).toBe(400);
      expect(response.url).not.toContain("oidc.callback");
      expect((await lastUpstreamAudit())?.reason).toBe("callback_invalid");
    });

    it("rejects a callback replayed without its transaction cookie", async () => {
      const erpUserId = await bridge.seedErpUser();
      const browser = bridge.newBrowser();
      const { callbackUrl } = await loginAtIdp(browser, erpUserId);

      const stranger = await bridge.newBrowser().get(callbackUrl);
      expect(stranger.status).toBe(400);
      expect((await lastUpstreamAudit())?.reason).toBe("transaction_missing");

      // Cookie transaction dùng 1 lần: chính trình duyệt đó mở lại cũng không được.
      expect((await browser.get(callbackUrl)).url).toContain("oidc.callback");
      expect((await browser.get(callbackUrl)).status).toBe(400);
    });

    it("shows the SSO button together with the system_admin form, and only starts SSO for the browser owning the interaction", async () => {
      const browser = bridge.newBrowser();
      const page = await browser.get(bridge.authorizationUrl());

      expect(page.status).toBe(200);
      expect(page.body).toContain("Đăng nhập SSO");
      expect(page.body).toMatch(/name="csrf" value="[^"]+"/);
      expect(page.url).not.toContain(idp().issuerUrl);

      const stranger = await bridge.newBrowser().get(`${page.url}/upstream`);
      expect(stranger.status).toBe(400);
      expect(stranger.url).not.toContain(idp().issuerUrl);
    });

    // Cuối cùng: tắt IdP giả, các test sau không dùng được nữa.
    it("answers 503 when the IdP is down at the token exchange", async () => {
      const erpUserId = await bridge.seedErpUser();
      const browser = bridge.newBrowser();
      const { callbackUrl } = await loginAtIdp(browser, erpUserId);
      await idp().stop();

      const response = await browser.get(callbackUrl);

      expect(response.status).toBe(503);
      expect((await lastUpstreamAudit())?.reason).toBe("idp_unavailable");
    });
  },
);
