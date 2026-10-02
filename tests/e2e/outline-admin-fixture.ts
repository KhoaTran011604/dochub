import { expect, type APIRequestContext, type Browser } from "@playwright/test";
import { e2eEnvironment } from "./e2e-environment.ts";

const FIXTURE_COLLECTION_NAME = "E2E SSO handoff";
const FIXTURE_DOCUMENT_TITLE = "E2E SSO handoff target";

interface OutlineList<T> {
  data: T[];
}

async function outlineApi<T>(
  request: APIRequestContext,
  endpoint: string,
  data: object,
) {
  // Gọi API bằng cookie phiên thì Outline đòi header CSRF trùng cookie `csrfToken`.
  const { cookies } = await request.storageState();
  const csrfToken =
    cookies.find((cookie) => cookie.name === "csrfToken")?.value ?? "";
  const response = await request.post(
    `${e2eEnvironment.outlineUrl}/api/${endpoint}`,
    {
      data,
      headers: { "x-csrf-token": csrfToken },
    },
  );
  expect(
    response.ok(),
    `${endpoint} → ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as T;
}

/**
 * Đăng nhập system_admin qua form của bridge, rồi chạy `work` với API Outline
 * dưới quyền admin.
 */
async function withOutlineAdminApi<T>(
  browser: Browser,
  work: (api: APIRequestContext) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // Outline chưa có phiên → tự chuyển sang bridge → form quản trị.
    await page.goto(e2eEnvironment.outlineUrl);
    await page.locator("#username").fill(e2eEnvironment.systemAdminUsername);
    await page.locator("#password").fill(e2eEnvironment.systemAdminPassword);
    await page.locator("button[type=submit]").click();
    await page.waitForURL(`${e2eEnvironment.outlineUrl}/**`);
    await page.waitForLoadState("networkidle");
    // Đóng trang: app Outline đang mở tự gọi API và xoay cookie csrfToken giữa chừng.
    await page.close();
    return await work(context.request);
  } finally {
    await context.close();
  }
}

const listUsersByEmail = async (api: APIRequestContext, email: string) =>
  (
    await outlineApi<OutlineList<{ id: string; email: string }>>(
      api,
      "users.list",
      { query: email, filter: "all" },
    )
  ).data.filter((user) => user.email === email);

/** Số account Outline mang email này (để kiểm SSO lặp lại không sinh user trùng). */
export const countOutlineUsersWithEmail = (browser: Browser, email: string) =>
  withOutlineAdminApi(
    browser,
    async (api) => (await listUsersByEmail(api, email)).length,
  );

/**
 * Dựng dữ liệu cho test (làm lại nhiều lần không sinh trùng): 1 collection
 * private + 1 doc, và user ERP được invite sẵn + cấp quyền sửa collection đó,
 * đúng thứ tự production (provision trước, SSO sau). Trả URL tuyệt đối của doc.
 */
export function prepareDocumentForErpUser(
  browser: Browser,
  erpUser: { email: string; name: string },
): Promise<string> {
  return withOutlineAdminApi(browser, async (api) => {
    const collections = await outlineApi<
      OutlineList<{ id: string; name: string }>
    >(api, "collections.list", { limit: 100 });
    const collectionId =
      collections.data.find(
        (collection) => collection.name === FIXTURE_COLLECTION_NAME,
      )?.id ??
      (
        await outlineApi<{ data: { id: string } }>(api, "collections.create", {
          name: FIXTURE_COLLECTION_NAME,
          permission: null,
        })
      ).data.id;

    const documents = await outlineApi<
      OutlineList<{ url: string; title: string }>
    >(api, "documents.list", { collectionId, limit: 100 });
    const documentPath =
      documents.data.find(
        (document) => document.title === FIXTURE_DOCUMENT_TITLE,
      )?.url ??
      (
        await outlineApi<{ data: { url: string } }>(api, "documents.create", {
          title: FIXTURE_DOCUMENT_TITLE,
          text: "Opened through the ERP SSO handoff link.",
          collectionId,
          publish: true,
        })
      ).data.url;

    // Email đã có thì Outline bỏ qua, không lỗi.
    await outlineApi(api, "users.invite", {
      invites: [{ email: erpUser.email, name: erpUser.name, role: "member" }],
    });
    const userId = (await listUsersByEmail(api, erpUser.email))[0]?.id;
    expect(userId, "invited ERP user exists in Outline").toBeTruthy();
    await outlineApi(api, "collections.add_user", {
      id: collectionId,
      userId,
      permission: "read_write",
    });

    return `${e2eEnvironment.outlineUrl}${documentPath}`;
  });
}
