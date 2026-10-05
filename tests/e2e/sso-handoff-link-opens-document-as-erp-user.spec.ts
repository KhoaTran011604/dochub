import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { e2eEnvironment, REPO_ROOT } from "./e2e-environment.ts";
import {
  countOutlineUsersWithEmail,
  prepareDocumentForErpUser,
} from "./outline-admin-fixture.ts";

const ERP_USER = {
  erpUserId: "e2e-sso-user",
  email: "e2e-sso-user@hd-document.test",
  name: "E2E SSO User",
};

const DOCUMENT_TEXT = "Opened through the ERP SSO handoff link.";

const BRIDGE_DIR = path.join(REPO_ROOT, "apps", "oidc-bridge");

/** Chạy 1 script dev của bridge (đóng vai ERP). Không qua shell → tham số an toàn. */
function runBridgeDevScript(script: string, args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--import", "tsx", path.join("scripts", "dev", script), ...args],
    {
      cwd: BRIDGE_DIR,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        APP_DATABASE_URL: e2eEnvironment.appDatabaseUrl,
        ERP_SSO_ISSUER: e2eEnvironment.erpSsoIssuer,
        ERP_SSO_AUDIENCE: e2eEnvironment.erpSsoAudience,
        BRIDGE_PUBLIC_URL: e2eEnvironment.bridgeUrl,
      },
    },
  ).trim();
}

const signSsoLink = (returnTo: string) =>
  runBridgeDevScript("sign-dev-sso-handoff-link.ts", [
    "--erp-user-id",
    ERP_USER.erpUserId,
    "--return-to",
    returnTo,
  ]);

/** URL của mọi trang thật sự hiện lên (redirect trung gian không tính). */
function recordShownPages(page: Page): string[] {
  const shown: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) shown.push(frame.url());
  });
  return shown;
}

/**
 * Outline giờ dừng ở màn login có nút "Continue with HD ERP" thay vì tự chuyển
 * sang bridge. Bấm nút = bước user duy nhất; handoff của bridge phải hoàn tất
 * im lặng sau đó (không form, không trang lỗi).
 */
async function continueWithErpIfLoginScreen(page: Page): Promise<void> {
  const button = page
    .getByRole("link", { name: /continue with hd erp/i })
    .or(page.getByRole("button", { name: /continue with hd erp/i }));
  const bridgeForm = page.locator("#username");
  await button.or(bridgeForm).or(page.getByText(DOCUMENT_TEXT)).first().waitFor({ timeout: 30_000 });
  if (await button.first().isVisible()) await button.first().click();
}

async function signedInEmail(page: Page): Promise<string | undefined> {
  const response = await page.request.post(
    `${e2eEnvironment.outlineUrl}/api/auth.info`,
  );
  if (!response.ok()) return undefined;
  const body = (await response.json()) as { data: { user: { email: string } } };
  return body.data.user.email;
}

test.describe.configure({ mode: "serial" });

test.describe("ERP SSO handoff link", () => {
  let documentUrl: string;
  let usedLink: string;

  test.beforeAll(async ({ browser }) => {
    runBridgeDevScript("seed-dev-erp-user.ts", [
      "--erp-user-id",
      ERP_USER.erpUserId,
      "--email",
      ERP_USER.email,
      "--name",
      ERP_USER.name,
    ]);
    documentUrl = await prepareDocumentForErpUser(browser, ERP_USER);
  });

  test("one click opens the document as the ERP user, with no login screen", async ({
    page,
  }) => {
    const shownPages = recordShownPages(page);
    usedLink = signSsoLink(documentUrl);

    await page.goto(usedLink, { referer: e2eEnvironment.erpReferrer });
    await continueWithErpIfLoginScreen(page);

    // Outline mở doc (chưa có phiên) → vòng OIDC qua bridge → quay lại đúng doc.
    await expect(page.getByText(DOCUMENT_TEXT)).toBeVisible({
      timeout: 45_000,
    });
    await page.waitForURL(documentUrl);
    expect(await signedInEmail(page)).toBe(ERP_USER.email);
    // Không trang nào của bridge (form đăng nhập, trang lỗi) từng hiện lên.
    expect(
      shownPages.filter((url) => url.startsWith(e2eEnvironment.bridgeUrl)),
    ).toEqual([]);

    // Bấm lại link cũ khi đã có phiên Outline: vẫn vào doc (F5 / back không vỡ).
    await page.goto(usedLink, { referer: e2eEnvironment.erpReferrer });
    await continueWithErpIfLoginScreen(page);
    await expect(page.getByText(DOCUMENT_TEXT)).toBeVisible({
      timeout: 45_000,
    });
    await page.waitForURL(documentUrl);
    expect(await signedInEmail(page)).toBe(ERP_USER.email);
  });

  test("a replayed link does not sign in a browser without a session", async ({
    page,
  }) => {
    await page.goto(usedLink, { referer: e2eEnvironment.erpReferrer });
    await continueWithErpIfLoginScreen(page);

    // Token đã dùng → không có handoff → dừng ở form quản trị của bridge.
    await expect(page.locator("#username")).toBeVisible();
    expect(
      page.url().startsWith(`${e2eEnvironment.bridgeUrl}/interaction/`),
    ).toBe(true);
    expect(await signedInEmail(page)).toBeUndefined();
  });

  test("a fresh link without the ERP referrer does not sign in", async ({
    page,
  }) => {
    await page.goto(signSsoLink(documentUrl));
    await continueWithErpIfLoginScreen(page);

    await expect(page.locator("#username")).toBeVisible();
    expect(await signedInEmail(page)).toBeUndefined();
  });

  test("a second SSO login of the same ERP user reuses the Outline account", async ({
    page,
    browser,
  }) => {
    // Trình duyệt mới (chưa có phiên) → đi lại trọn vòng OIDC với cùng `sub`.
    await page.goto(signSsoLink(documentUrl), {
      referer: e2eEnvironment.erpReferrer,
    });
    await continueWithErpIfLoginScreen(page);
    await expect(page.getByText(DOCUMENT_TEXT)).toBeVisible({
      timeout: 45_000,
    });
    expect(await signedInEmail(page)).toBe(ERP_USER.email);

    expect(await countOutlineUsersWithEmail(browser, ERP_USER.email)).toBe(1);
  });
});
