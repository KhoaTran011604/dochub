import { OutlineBadRequestError, OutlineNotFoundError } from "./outline-api-errors.ts";
import type { OutlineHttpClient } from "./outline-http-client.ts";
import type { OutlineGroup } from "./outline-api-types.ts";

/** Không idempotent: `retry: false` để không tạo group trùng khi response bị mất. */
export async function createGroup(
  client: OutlineHttpClient,
  input: { name: string; externalId?: string },
): Promise<OutlineGroup> {
  return client.request<OutlineGroup>("groups.create", input, { retry: false });
}

export async function listGroups(
  client: OutlineHttpClient,
  params: { query?: string; limit?: number } = {},
): Promise<OutlineGroup[]> {
  // Khác với `users.list` (data là mảng phẳng), `groups.list` bọc data trong
  // `{ groups: [...], groupMemberships: [...] }` (xác nhận sống trên Outline 1.10.1).
  const { groups } = await client.request<{ groups: OutlineGroup[] }>("groups.list", {
    limit: 100,
    ...params,
  });
  return groups;
}

/** Tra ngược group theo `externalId` (quy ước `<projectKey>:<role>`), dùng để chạy lại an toàn. */
export async function findGroupByExternalId(
  client: OutlineHttpClient,
  externalId: string,
): Promise<OutlineGroup | undefined> {
  const groups = await listGroups(client);
  return groups.find((group) => group.externalId === externalId);
}

export async function addUserToGroup(
  client: OutlineHttpClient,
  groupId: string,
  userId: string,
): Promise<void> {
  await client.request("groups.add_user", { id: groupId, userId });
}

/**
 * Gỡ user khỏi group. Coi "user không thuộc group" là thành công (idempotent):
 * PUT đổi role dự án gỡ khỏi 2 group cũ trước khi thêm vào group mới, và DELETE
 * có thể được ERP gọi lại nhiều lần cho cùng kết quả.
 */
export async function removeUserFromGroup(
  client: OutlineHttpClient,
  groupId: string,
  userId: string,
): Promise<void> {
  try {
    await client.request("groups.remove_user", { id: groupId, userId });
  } catch (error) {
    if (error instanceof OutlineBadRequestError || error instanceof OutlineNotFoundError) {
      return;
    }
    throw error;
  }
}
