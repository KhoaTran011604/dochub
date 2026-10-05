import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { expirePendingRequest } from "./bridge-dev-scripts.ts";
import { grantConsentByCreatingNode, revokeApplicationInOutline } from "./consent-flow-helpers.ts";
import { createNodeEnvironment } from "./e2e-environment.ts";
import {
  countDocumentsTitled,
  createNode,
  deleteOutlineDocumentQuietly,
  E2E_PROJECT_KEY,
  e2eUser,
  openPendingUrlAndConsent,
  outlineAdmin,
  permissionApi,
  provisionUserInProject,
  setRole,
  signInOutlineAs,
} from "./permission-api-fixture.ts";

// Kiểm tích hợp phase 5 với Outline thật (stack compose đang chạy). Mỗi test
// dùng 1 user riêng để trạng thái grant không lẫn nhau. Cần E2E_PERMISSION_API_SERVICE_KEY.
test.skip(!createNodeEnvironment.serviceKey, "E2E_PERMISSION_API_SERVICE_KEY is not set");
test.describe.configure({ mode: "serial" });

const run = randomUUID().slice(0, 8);
const createdDocumentIds: string[] = [];
const bodyFor = (actingErpUserId: string, title: string) => ({
  projectKey: E2E_PROJECT_KEY,
  actingErpUserId,
  title: `${title} ${run}`,
  text: `Body of ${title}.`,
});

test.afterAll(async () => {
  await Promise.all(createdDocumentIds.map(deleteOutlineDocumentQuietly));
});

test("author is the real user; same key twice makes one doc; a viewer gets 403", async ({ page }) => {
  const user = e2eUser("author", 2);
  await provisionUserInProject(user, E2E_PROJECT_KEY, "editor");
  await signInOutlineAs(page, user);
  createdDocumentIds.push(await grantConsentByCreatingNode(page, user, `author-${run}-0`, `Author seed ${run}`));

  // Doc tạo bằng token user: tác giả là chính user (không phải admin/account dịch vụ).
  const created = await createNode(`author-${run}-1`, bodyFor(user.erpUserId, "Authored"));
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  createdDocumentIds.push(created.body.documentId);
  const info = await outlineAdmin<{ data: { createdBy: { name: string } } }>("documents.info", {
    id: created.body.documentId,
  });
  expect(info.data.createdBy.name).toBe(user.name);

  // Cùng key: 2 lần song song rồi 1 lần nữa → đúng 1 doc.
  const racing = bodyFor(user.erpUserId, "Raced");
  const results = await Promise.all([createNode(`race-${run}`, racing), createNode(`race-${run}`, racing)]);
  for (const result of results) expect(result.status, JSON.stringify(result.body)).toBe(201);
  const settled = await createNode(`race-${run}`, racing);
  expect(settled.status, JSON.stringify(settled.body)).toBe(201);
  createdDocumentIds.push(settled.body.documentId);
  expect(await countDocumentsTitled(racing.title)).toBe(1);

  // Hạ xuống viewer: Outline từ chối ghi → 403, không tạo gì.
  await setRole(user, E2E_PROJECT_KEY, "viewer");
  const viewerBody = bodyFor(user.erpUserId, "Viewer attempt");
  const forbidden = await createNode(`viewer-${run}`, viewerBody);
  expect(forbidden.status, JSON.stringify(forbidden.body)).toBe(403);
  expect(forbidden.body.error.code).toBe("ACTING_USER_FORBIDDEN");
  expect(await countDocumentsTitled(viewerBody.title)).toBe(0);
});

test("someone else completing the pendingUrl gets 403 and no grant is saved", async ({ browser }) => {
  const victim = e2eUser("victim", 3);
  const intruder = e2eUser("intruder", 4);
  await provisionUserInProject(victim, E2E_PROJECT_KEY, "editor");
  await provisionUserInProject(intruder, E2E_PROJECT_KEY, "editor");

  const pending = await createNode(`victim-${run}`, bodyFor(victim.erpUserId, "Victim doc"));
  expect(pending.status).toBe(202);

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signInOutlineAs(page, intruder);
    await page.goto(pending.body.pendingUrl);
    const callback = page.waitForResponse((response) => response.url().includes("/oauth/outline/callback"));
    await page.getByRole("button", { name: /authorize/i }).click();
    expect((await callback).status()).toBe(403);
    await expect(page.getByText(/different user/i)).toBeVisible();
  } finally {
    await context.close();
  }

  // Không grant nào được lưu cho victim: key mới vẫn đi đường 202, không có doc nào.
  const next = await createNode(`victim-${run}-2`, bodyFor(victim.erpUserId, "Victim doc 2"));
  expect(next.status, JSON.stringify(next.body)).toBe(202);
  expect(await countDocumentsTitled(`Victim doc ${run}`)).toBe(0);
});

test("an expired pending request answers 410 on the browser route and on replay", async ({ request }) => {
  const user = e2eUser("expiry", 5);
  await provisionUserInProject(user, E2E_PROJECT_KEY, "editor");
  const body = bodyFor(user.erpUserId, "Will expire");
  const pending = await createNode(`expiry-${run}`, body);
  expect(pending.status).toBe(202);

  expirePendingRequest(pending.body.requestId);

  const browserRoute = await request.get(pending.body.pendingUrl, { maxRedirects: 0 });
  expect(browserRoute.status()).toBe(410);
  const replay = await createNode(`expiry-${run}`, body);
  expect(replay.status).toBe(410);
  expect(replay.body.error.code).toBe("PENDING_REQUEST_EXPIRED");
});

test("a grant revoked on the Outline side makes the next create go back to 202", async ({ page }) => {
  const user = e2eUser("revoked", 6);
  await provisionUserInProject(user, E2E_PROJECT_KEY, "editor");
  await signInOutlineAs(page, user);
  createdDocumentIds.push(await grantConsentByCreatingNode(page, user, `revoked-${run}-0`, `Revoked seed ${run}`));

  const before = await createNode(`revoked-${run}-1`, bodyFor(user.erpUserId, "Before revoke"));
  expect(before.status, JSON.stringify(before.body)).toBe(201);
  createdDocumentIds.push(before.body.documentId);

  await revokeApplicationInOutline(page);

  const afterBody = bodyFor(user.erpUserId, "After revoke");
  const after = await createNode(`revoked-${run}-2`, afterBody);
  expect(after.status, JSON.stringify(after.body)).toBe(202);

  // Đồng ý lại → hoàn tất, các lần sau lại 201.
  await openPendingUrlAndConsent(page, after.body.pendingUrl);
  await page.waitForURL(/\/doc\//, { timeout: 30_000 });
  const done = await createNode(`revoked-${run}-2`, afterBody);
  expect(done.status, JSON.stringify(done.body)).toBe(201);
  createdDocumentIds.push(done.body.documentId);
  const next = await createNode(`revoked-${run}-3`, bodyFor(user.erpUserId, "After re-consent"));
  expect(next.status).toBe(201);
  createdDocumentIds.push(next.body.documentId);
});

test("input validation is enforced against the live API", async () => {
  const user = e2eUser("author", 2);
  const noKey = await permissionApi("POST", "/documents", { body: bodyFor(user.erpUserId, "x") });
  expect(noKey.status).toBe(400);
  const unknownUser = await createNode(`unknown-${run}`, bodyFor(randomUUID(), "x"));
  expect(unknownUser.status).toBe(404);
  const unknownProject = await createNode(`noproj-${run}`, { ...bodyFor(user.erpUserId, "x"), projectKey: "no-such-project" });
  expect(unknownProject.status).toBe(404);
});
