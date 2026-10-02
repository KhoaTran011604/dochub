import { generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ERP_REFERRER,
  integrationDatabaseAvailable,
  OUTLINE_URL,
  startBridgeTestHarness,
  type BridgeTestHarness,
} from "../test-support/bridge-test-harness.ts";
import { auditOutcomesFor } from "../test-support/read-auth-audit-rows.ts";
import { SSO_HANDOFF_COOKIE_NAME } from "./sso-handoff-route.ts";

const DOCUMENT_URL = `${OUTLINE_URL}/doc/hop-dong-abc123`;
const fromErp = { referer: ERP_REFERRER };

// Cần Postgres thật đã migrate: đặt APP_DATABASE_URL (owner) + BRIDGE_DATABASE_URL (bridge_app).
describe.skipIf(!integrationDatabaseAvailable)(
  "GET /sso (real Postgres)",
  () => {
    let bridge: BridgeTestHarness;

    beforeAll(async () => {
      bridge = await startBridgeTestHarness();
    });
    afterAll(async () => {
      await bridge?.stop();
    });

    it("signs the ERP user in without any form and issues their claims to Outline", async () => {
      const erpUserId = await bridge.seedErpUser();
      const browser = bridge.newBrowser();

      const sso = await browser.get(
        bridge.ssoUrl(await bridge.signHandoffToken(erpUserId), DOCUMENT_URL),
        fromErp,
      );
      expect(sso.status).toBe(302);
      expect(sso.url).toBe(DOCUMENT_URL);
      expect(sso.headers.get("referrer-policy")).toBe("no-referrer");
      expect(sso.headers.get("cache-control")).toBe("no-store");
      const handoffCookie = sso.setCookies.find((cookie) =>
        cookie.startsWith(`${SSO_HANDOFF_COOKIE_NAME}=`),
      );
      expect(handoffCookie).toMatch(/path=\/interaction/i);
      expect(handoffCookie).toMatch(/httponly/i);
      // Cookie không mang danh tính.
      expect(handoffCookie).not.toContain(erpUserId);

      // Outline (chưa có phiên) đưa trình duyệt sang /auth → về thẳng callback, không dừng ở form.
      const login = await browser.get(bridge.authorizationUrl());
      expect(login.url).toContain(`${OUTLINE_URL}/auth/oidc.callback?code=`);

      expect(await bridge.exchangeCodeForClaims(login.url)).toEqual({
        sub: `erp:${erpUserId}`,
        email: `${erpUserId}@hd-document.test`,
        email_verified: true,
        name: `User ${erpUserId}`,
        preferred_username: `${erpUserId}@hd-document.test`,
      });
    });

    it("rejects a replayed token and lets a handoff be used only once", async () => {
      const erpUserId = await bridge.seedErpUser();
      const token = await bridge.signHandoffToken(erpUserId, {
        jti: `replay-${erpUserId}`,
      });
      const victim = bridge.newBrowser();
      await victim.get(bridge.ssoUrl(token, DOCUMENT_URL), fromErp);

      // Kẻ nhặt được link dùng lại token: không có handoff, dừng ở form.
      const attacker = bridge.newBrowser();
      const replay = await attacker.get(
        bridge.ssoUrl(token, DOCUMENT_URL),
        fromErp,
      );
      expect(replay.status).toBe(302);
      expect(replay.url).toBe(DOCUMENT_URL);
      expect(attacker.hasCookie(SSO_HANDOFF_COOKIE_NAME)).toBe(false);
      expect((await attacker.get(bridge.authorizationUrl())).status).toBe(200);
      expect(
        await auditOutcomesFor(bridge.ownerPool, `replay-${erpUserId}`),
      ).toEqual([
        { outcome: "success", reason: null },
        { outcome: "rejected", reason: "token_replayed" },
      ]);

      // Cookie handoff bị chép sang máy khác: ai dùng trước thắng, người sau gặp form.
      const thief = bridge.newBrowser();
      victim.copyCookiesTo(thief);
      expect((await victim.get(bridge.authorizationUrl())).url).toContain(
        "oidc.callback?code=",
      );
      expect((await thief.get(bridge.authorizationUrl())).status).toBe(200);
    });

    it("does not create a handoff without a valid ERP referrer", async () => {
      const erpUserId = await bridge.seedErpUser();

      const foreignReferrers: Record<string, string>[] = [
        {},
        { referer: "http://evil.test.invalid/page" },
      ];
      for (const headers of foreignReferrers) {
        const browser = bridge.newBrowser();
        const response = await browser.get(
          bridge.ssoUrl(await bridge.signHandoffToken(erpUserId), DOCUMENT_URL),
          headers,
        );
        expect(response.status).toBe(302);
        expect(browser.hasCookie(SSO_HANDOFF_COOKIE_NAME)).toBe(false);
      }
    });

    it("does not create a handoff for a token signed by another key", async () => {
      const erpUserId = await bridge.seedErpUser();
      const { privateKey: attackerKey } = await generateKeyPair("ES256");
      const browser = bridge.newBrowser();

      const response = await browser.get(
        bridge.ssoUrl(
          await bridge.signHandoffToken(erpUserId, { key: attackerKey }),
          DOCUMENT_URL,
        ),
        fromErp,
      );

      expect(response.status).toBe(302);
      expect(browser.hasCookie(SSO_HANDOFF_COOKIE_NAME)).toBe(false);
    });
  },
);
