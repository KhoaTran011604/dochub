/// <reference lib="dom" />
import { expect, type Page } from "@playwright/test";
import { e2eEnvironment } from "./e2e-environment.ts";
import {
  createNode,
  E2E_PROJECT_KEY,
  openPendingUrlAndConsent,
  type E2eErpUser,
} from "./permission-api-fixture.ts";

/** Cho user (đã có phiên Outline trên `page`) đồng ý OAuth 1 lần bằng cách tạo 1 node. Trả documentId. */
export async function grantConsentByCreatingNode(
  page: Page,
  user: E2eErpUser,
  key: string,
  title: string,
): Promise<string> {
  const body = { projectKey: E2E_PROJECT_KEY, actingErpUserId: user.erpUserId, title, text: "consent" };
  const pending = await createNode(key, body);
  expect(pending.status, JSON.stringify(pending.body)).toBe(202);
  await openPendingUrlAndConsent(page, pending.body.pendingUrl);
  await page.waitForURL(/\/doc\//, { timeout: 30_000 });
  const done = await createNode(key, body);
  expect(done.status, JSON.stringify(done.body)).toBe(201);
  return done.body.documentId;
}

/**
 * User tự thu hồi app trong Outline (Settings → Applications). Gọi API từ chính
 * trang Outline (fetch trong trình duyệt) để cookie phiên + CSRF luôn là bản mới nhất.
 */
export async function revokeApplicationInOutline(page: Page): Promise<void> {
  await page.goto(`${e2eEnvironment.outlineUrl}/home`);
  // App Outline đang chạy nền xoay cookie csrfToken; đợi yên rồi mới gọi API.
  await page.waitForLoadState("networkidle");
  const result = await page.evaluate(async () => {
    const callOnce = async (endpoint: string, data: object) => {
      const csrf = document.cookie.match(/(?:^|; )csrfToken=([^;]+)/)?.[1] ?? "";
      const response = await fetch(`/api/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(data),
      });
      return { status: response.status, json: (await response.json().catch(() => ({}))) as unknown };
    };
    // 403 = CSRF vừa xoay giữa chừng: đọc lại cookie và thử lại tối đa 3 lần.
    const call = async (endpoint: string, data: object) => {
      let result = await callOnce(endpoint, data);
      for (let retry = 0; retry < 3 && result.status === 403; retry++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        result = await callOnce(endpoint, data);
      }
      return result;
    };
    const list = await call("oauthAuthentications.list", {});
    const statuses: number[] = [list.status];
    for (const authentication of (list.json as { data?: { oauthClientId: string }[] }).data ?? []) {
      statuses.push((await call("oauthAuthentications.delete", { oauthClientId: authentication.oauthClientId })).status);
    }
    return statuses;
  });
  expect(result.length, "user has an authorization to revoke").toBeGreaterThan(1);
  expect(result.every((status) => status === 200), result.join(",")).toBe(true);
}
