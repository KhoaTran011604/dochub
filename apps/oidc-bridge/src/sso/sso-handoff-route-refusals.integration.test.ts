import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  "GET /sso refusals (real Postgres)",
  () => {
    let bridge: BridgeTestHarness;

    beforeAll(async () => {
      bridge = await startBridgeTestHarness();
    });
    afterAll(async () => {
      await bridge?.stop();
    });

    it("never redirects to a returnTo outside the allow-list", async () => {
      const erpUserId = await bridge.seedErpUser();
      const jti = `open-redirect-${erpUserId}`;
      const browser = bridge.newBrowser();

      const response = await browser.get(
        bridge.ssoUrl(
          await bridge.signHandoffToken(erpUserId, { jti }),
          "https://evil.test.invalid/",
        ),
        fromErp,
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
      expect(browser.hasCookie(SSO_HANDOFF_COOKIE_NAME)).toBe(false);
      // Token chưa bị tiêu: không có dòng handoff nào cho jti này.
      const handoffs = await bridge.ownerPool.query(
        `SELECT 1 FROM bridge.sso_handoffs WHERE jti = $1`,
        [jti],
      );
      expect(handoffs.rowCount).toBe(0);
    });

    it("refuses unknown users, deactivated users and users holding the admin email", async () => {
      const cases = [
        { erpUserId: "it-user-that-does-not-exist", reason: "unknown_user" },
        {
          erpUserId: await bridge.seedErpUser({ status: "deactivated" }),
          reason: "deactivated",
        },
        {
          erpUserId: await bridge.seedErpUser({
            email: bridge.config.SYSTEM_ADMIN_EMAIL.toUpperCase(),
          }),
          reason: "email_reserved_for_system_admin",
        },
      ];

      for (const { erpUserId, reason } of cases) {
        // Audit chỉ thêm, không xóa: jti phải khác nhau giữa các lần chạy test.
        const jti = `refused-${reason}-${randomUUID()}`;
        const browser = bridge.newBrowser();
        const response = await browser.get(
          bridge.ssoUrl(
            await bridge.signHandoffToken(erpUserId, { jti }),
            DOCUMENT_URL,
          ),
          fromErp,
        );

        expect(response.status).toBe(403);
        expect(browser.hasCookie(SSO_HANDOFF_COOKIE_NAME)).toBe(false);
        expect(await auditOutcomesFor(bridge.ownerPool, jti)).toEqual([
          { outcome: "rejected", reason },
        ]);
      }
    });

    it("never writes the token to the log", async () => {
      const erpUserId = await bridge.seedErpUser();
      const token = await bridge.signHandoffToken(erpUserId);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await bridge
          .newBrowser()
          .get(bridge.ssoUrl(token, DOCUMENT_URL), fromErp);
        await bridge
          .newBrowser()
          .get(bridge.ssoUrl(token, DOCUMENT_URL), fromErp);

        const written = [...log.mock.calls, ...error.mock.calls]
          .flat()
          .join("\n");
        expect(written).toContain("GET /sso 302");
        expect(written).not.toContain(token);
        expect(written).not.toContain(token.split(".")[2]);
      } finally {
        log.mockRestore();
        error.mockRestore();
      }
    });
  },
);
