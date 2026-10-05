import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createNodeEnvironment } from "./e2e-environment.ts";
import {
  createNode,
  deleteOutlineDocumentQuietly,
  E2E_PROJECT_KEY,
  e2eUser,
  permissionApi,
  provisionUserInProject,
  signInOutlineAs,
  type E2eErpUser,
} from "./permission-api-fixture.ts";

// Kiểm tích hợp phase 7 với Outline thật. Key E2E cần thêm scope `tree:read`.
test.skip(!createNodeEnvironment.serviceKey, "E2E_PERMISSION_API_SERVICE_KEY is not set");
test.describe.configure({ mode: "serial" });

interface TreeNode {
  id: string;
  title: string;
  url: string;
  parentDocumentId: string | null;
  hasMoreChildren: boolean;
  children: TreeNode[];
}
interface TreeBody {
  nodes: TreeNode[];
  truncated: boolean;
  parentDocumentId: string | null;
  grantUrl?: string;
  error?: { code: string };
}

const run = randomUUID().slice(0, 8);
const createdDocumentIds: string[] = [];

const getTree = async (user: E2eErpUser, extra = "") => {
  const result = await permissionApi("GET", `/projects/${E2E_PROJECT_KEY}/document-tree?actingErpUserId=${user.erpUserId}${extra}`);
  return { status: result.status, body: result.body as unknown as TreeBody };
};

test.afterAll(async () => {
  await Promise.all(createdDocumentIds.map(deleteOutlineDocumentQuietly));
});

test("409 grantUrl → consent → tree shows only titles/links; member scope respected", async ({ page }) => {
  const user = e2eUser("author", 2);
  await provisionUserInProject(user, E2E_PROJECT_KEY, "editor");
  await signInOutlineAs(page, user);

  const before = await getTree(user);
  expect(before.status, JSON.stringify(before.body)).toBe(409);
  expect(before.body.error?.code).toBe("OUTLINE_GRANT_REQUIRED");
  expect(before.body.grantUrl).toContain("/pending/");

  // Gọi lại khi chưa đồng ý: cùng 1 link (không sinh dòng mới).
  const again = await getTree(user);
  expect(again.body.grantUrl).toBe(before.body.grantUrl);

  await page.goto(before.body.grantUrl ?? "");
  await page.getByRole("button", { name: /authorize|allow|approve|đồng ý|cho phép/i }).click();
  await expect(page.getByText(/access granted/i)).toBeVisible({ timeout: 30_000 });

  const parent = await createNode(`tree-parent-${run}`, {
    projectKey: E2E_PROJECT_KEY,
    actingErpUserId: user.erpUserId,
    title: `Tree parent ${run}`,
    text: "SECRET-BODY-TEXT",
  });
  expect(parent.status, JSON.stringify(parent.body)).toBe(201);
  createdDocumentIds.push(parent.body.documentId);
  const child = await createNode(`tree-child-${run}`, {
    projectKey: E2E_PROJECT_KEY,
    actingErpUserId: user.erpUserId,
    title: `Tree child ${run}`,
    text: "SECRET-BODY-TEXT",
    parentDocumentId: parent.body.documentId,
  });
  expect(child.status, JSON.stringify(child.body)).toBe(201);
  createdDocumentIds.push(child.body.documentId);

  const full = await getTree(user, "&depth=3");
  expect(full.status, JSON.stringify(full.body)).toBe(200);
  expect(JSON.stringify(full.body)).not.toContain("SECRET-BODY-TEXT");
  const parentNode = full.body.nodes.find((node) => node.id === parent.body.documentId);
  expect(parentNode?.title).toBe(`Tree parent ${run}`);
  expect(parentNode?.url).toMatch(/^https?:\/\//);
  expect(parentNode?.children.map((node) => [node.id, node.parentDocumentId])).toEqual([
    [child.body.documentId, parent.body.documentId],
  ]);

  // depth=1: node cha báo còn con; lấy tiếp theo parentDocumentId.
  const shallow = await getTree(user, "&depth=1");
  expect(shallow.body.nodes.find((node) => node.id === parent.body.documentId)).toMatchObject({
    hasMoreChildren: true,
    children: [],
  });
  const level = await getTree(user, `&depth=1&parentDocumentId=${parent.body.documentId}`);
  expect(level.status, JSON.stringify(level.body)).toBe(200);
  expect(level.body.nodes.map((node) => node.id)).toEqual([child.body.documentId]);
});

test("user outside the project: after consent gets 403 and no titles", async ({ page }) => {
  const outsider = e2eUser("intruder", 4);
  // Có tài khoản Outline nhưng không có role trong project E2E.
  await provisionUserInProject(outsider, E2E_PROJECT_KEY, "viewer");
  const removed = await permissionApi("DELETE", `/projects/${E2E_PROJECT_KEY}/members/${outsider.erpUserId}`);
  expect(removed.status).toBeLessThan(300);
  await signInOutlineAs(page, outsider);

  const first = await getTree(outsider);
  expect(first.status, JSON.stringify(first.body)).toBe(409);
  await page.goto(first.body.grantUrl ?? "");
  await page.getByRole("button", { name: /authorize|allow|approve|đồng ý|cho phép/i }).click();
  await expect(page.getByText(/access granted/i)).toBeVisible({ timeout: 30_000 });

  const denied = await getTree(outsider);
  expect(denied.status, JSON.stringify(denied.body)).toBe(403);
  expect(denied.body.error?.code).toBe("ACTING_USER_FORBIDDEN");
  expect(denied.body.nodes).toBeUndefined();
});
