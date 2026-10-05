import { expect, type Page } from "@playwright/test";
import { signSsoLink } from "./bridge-dev-scripts.ts";
import { createNodeEnvironment, e2eEnvironment } from "./e2e-environment.ts";

/** Các field có mặt tùy status (202: requestId/pendingUrl; 201: documentId/url; lỗi: error). */
export interface ApiResult {
  status: number;
  body: {
    requestId: string;
    pendingUrl: string;
    expiresAt: string;
    documentId: string;
    url: string;
    error: { code: string; message: string };
  };
}

/** Gọi permission API bằng service key của test (đóng vai ERP). */
export async function permissionApi(
  method: string,
  path: string,
  options: { body?: object; idempotencyKey?: string } = {},
): Promise<ApiResult> {
  const response = await fetch(`${createNodeEnvironment.permissionApiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${createNodeEnvironment.serviceKey}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as ApiResult["body"] };
}

export interface E2eErpUser {
  erpUserId: string;
  email: string;
  name: string;
}

export interface CreateNodeBody {
  projectKey: string;
  actingErpUserId: string;
  title: string;
  text: string;
  parentDocumentId?: string;
}

export const createNode = (key: string, body: CreateNodeBody) =>
  permissionApi("POST", "/documents", { body, idempotencyKey: key });

/**
 * Dựng user + project + role như ERP thật. `deactivate` → `activate` xóa grant
 * OAuth cũ (phase 5), nên mỗi lần chạy user đều ở trạng thái "chưa đồng ý".
 */
export async function provisionUserInProject(
  user: E2eErpUser,
  projectKey: string,
  role: "viewer" | "editor" | "manager",
): Promise<void> {
  const put = await permissionApi("PUT", `/users/${user.erpUserId}`, {
    body: { email: user.email, name: user.name },
  });
  expect(put.status, JSON.stringify(put.body)).toBeLessThan(300);
  await permissionApi("POST", `/users/${user.erpUserId}/deactivate`);
  const activate = await permissionApi("POST", `/users/${user.erpUserId}/activate`);
  expect(activate.status, JSON.stringify(activate.body)).toBe(200);
  const project = await permissionApi("PUT", `/projects/${projectKey}`, {
    body: { name: `E2E ${projectKey}` },
  });
  expect(project.status, JSON.stringify(project.body)).toBeLessThan(300);
  await setRole(user, projectKey, role);
}

export async function setRole(user: E2eErpUser, projectKey: string, role: string) {
  const result = await permissionApi("PUT", `/projects/${projectKey}/members/${user.erpUserId}`, {
    body: { role },
  });
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
}

/** Đăng nhập Outline bằng link SSO handoff (như user bấm link từ ERP). */
export async function signInOutlineAs(page: Page, user: E2eErpUser): Promise<void> {
  await page.goto(signSsoLink(user.erpUserId, `${e2eEnvironment.outlineUrl}/home`), {
    referer: e2eEnvironment.erpReferrer,
  });
  await page.waitForURL(`${e2eEnvironment.outlineUrl}/**`, { timeout: 45_000 });
  // /home chưa có phiên → màn Login của Outline (không tự chuyển sang bridge);
  // bridge đã giữ handoff nên nút này đi thẳng qua, không hỏi gì.
  const ssoButton = page.getByRole("link", { name: /continue with hd erp/i }).or(page.getByRole("button", { name: /continue with hd erp/i }));
  await ssoButton.click({ timeout: 15_000 }).catch(() => undefined);
  await expect.poll(() => outlineEmail(page), { timeout: 30_000 }).toBe(user.email);
}

export async function outlineEmail(page: Page): Promise<string | undefined> {
  const response = await page.request.post(`${e2eEnvironment.outlineUrl}/api/auth.info`);
  if (!response.ok()) return undefined;
  const body = (await response.json()) as { data: { user: { email: string } } };
  return body.data.user.email;
}

/** Mở pendingUrl và bấm Đồng ý trên màn OAuth của Outline; kết thúc khi về trang doc. */
export async function openPendingUrlAndConsent(page: Page, pendingUrl: string): Promise<void> {
  await page.goto(pendingUrl);
  await page.getByRole("button", { name: /authorize|allow|approve|đồng ý|cho phép/i }).click();
}

/** Gọi Outline bằng token admin (chỉ để đọc tác giả + dọn dữ liệu test). */
export async function outlineAdmin<T>(endpoint: string, data: object): Promise<T> {
  const response = await fetch(`${e2eEnvironment.outlineUrl}/api/${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${createNodeEnvironment.outlineAdminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(data),
  });
  expect(response.ok, `${endpoint} → ${response.status}`).toBe(true);
  return (await response.json()) as T;
}

/** Xóa mềm rồi xóa vĩnh viễn (Outline chỉ cho xóa vĩnh viễn doc đã vào thùng rác). */
export async function deleteOutlineDocumentQuietly(id: string): Promise<void> {
  await outlineAdmin("documents.delete", { id }).catch(() => undefined);
  await outlineAdmin("documents.delete", { id, permanent: true }).catch(() => undefined);
}

export const E2E_PROJECT_KEY = "e2e-create-node";

/** UUID cố định: chạy lại dùng lại cùng account Outline (không sinh user mới mỗi lần). */
export const e2eUser = (suffix: string, n: number): E2eErpUser => ({
  erpUserId: `7c1e6f0a-0000-4000-8000-00000000c0${n.toString().padStart(2, "0")}`,
  email: `e2e-create-node-${suffix}@hd-document.test`,
  name: `E2E Create Node ${suffix}`,
});

/** Số doc Outline có đúng tiêu đề này trong collection của project (thấy qua token admin). */
export async function countDocumentsTitled(title: string): Promise<number> {
  const result = await outlineAdmin<{ data: { title: string }[] }>("documents.search_titles", {
    query: title,
    limit: 50,
  });
  return result.data.filter((document) => document.title === title).length;
}
