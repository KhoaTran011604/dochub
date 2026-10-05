import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createNodeEnvironment } from "./e2e-environment.ts";
import {
  createNode,
  deleteOutlineDocumentQuietly,
  E2E_PROJECT_KEY,
  e2eUser,
  openPendingUrlAndConsent,
  outlineAdmin,
  provisionUserInProject,
  signInOutlineAs,
} from "./permission-api-fixture.ts";

// Luồng chính phase 5 trên stack thật: ERP gọi API → 202 → user mở pendingUrl →
// đồng ý 1 lần → vào doc → các lần sau 201 ngay. Cần E2E_PERMISSION_API_SERVICE_KEY.
test.skip(!createNodeEnvironment.serviceKey, "E2E_PERMISSION_API_SERVICE_KEY is not set");
test.describe.configure({ mode: "serial" });

const USER = e2eUser("consent", 1);
const run = randomUUID().slice(0, 8);
const KEY = `e2e-consent-${run}`;
const body = {
  projectKey: E2E_PROJECT_KEY,
  actingErpUserId: USER.erpUserId,
  title: `Consent flow ${run}`,
  text: "Created through the pending consent flow.",
};
const createdDocumentIds: string[] = [];

test.beforeAll(async () => {
  await provisionUserInProject(USER, E2E_PROJECT_KEY, "editor");
});
test.afterAll(async () => {
  await Promise.all(createdDocumentIds.map(deleteOutlineDocumentQuietly));
});

test("202 → pendingUrl → consent → lands on the new doc, authored by the user", async ({ page }) => {
  const first = await createNode(KEY, body);
  expect(first.status, JSON.stringify(first.body)).toBe(202);
  const { requestId, pendingUrl } = first.body;
  expect(pendingUrl).toMatch(new RegExp(`/pending/${requestId}$`));

  // Còn chờ: gọi lại cùng key + cùng body trả lại đúng 202 cũ.
  const stillPending = await createNode(KEY, body);
  expect(stillPending.status).toBe(202);
  expect(stillPending.body.requestId).toBe(requestId);

  await signInOutlineAs(page, USER);
  await openPendingUrlAndConsent(page, pendingUrl);
  await page.waitForURL(/\/doc\//, { timeout: 30_000 });
  await expect(page.getByText(body.text)).toBeVisible({ timeout: 30_000 });

  // Replay sau khi hoàn tất → 201 với documentId thật.
  const replay = await createNode(KEY, body);
  expect(replay.status, JSON.stringify(replay.body)).toBe(201);
  const documentId: string = replay.body.documentId;
  createdDocumentIds.push(documentId);
  expect(page.url()).toBe(replay.body.url);

  const info = await outlineAdmin<{ data: { createdBy: { name: string } } }>("documents.info", { id: documentId });
  expect(info.data.createdBy.name).toBe(USER.name);

  // Replay lần nữa vẫn cùng documentId (không tạo doc thứ 2).
  const again = await createNode(KEY, body);
  expect(again.status).toBe(201);
  expect(again.body.documentId).toBe(documentId);
});

test("the same user's next key creates immediately with 201", async () => {
  const second = await createNode(`${KEY}-second`, { ...body, title: `${body.title} second` });
  expect(second.status, JSON.stringify(second.body)).toBe(201);
  expect(second.body.url).toMatch(/\/doc\//);
  createdDocumentIds.push(second.body.documentId);
});

test("the same key with a different body is rejected with 409", async () => {
  const conflict = await createNode(KEY, { ...body, title: `${body.title} changed` });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
});
