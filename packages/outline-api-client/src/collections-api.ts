import type { OutlineHttpClient } from "./outline-http-client.ts";
import type { OutlineCollection, OutlineNavigationNode, OutlinePermission } from "./outline-api-types.ts";

/**
 * `permission: null` cho collection private, không ai mặc định vào được trừ
 * group được `addGroupToCollection`. Không idempotent → `retry: false`.
 */
export async function createCollection(
  client: OutlineHttpClient,
  input: { name: string; permission: OutlinePermission | null },
): Promise<OutlineCollection> {
  return client.request<OutlineCollection>("collections.create", input, {
    retry: false,
  });
}

/**
 * Cây tài liệu của collection theo quyền của chủ token (gọi bằng token user).
 * Chỉ tiêu đề/đường dẫn, không có nội dung.
 */
export async function listCollectionDocuments(
  client: OutlineHttpClient,
  collectionId: string,
): Promise<OutlineNavigationNode[]> {
  return client.request<OutlineNavigationNode[]>("collections.documents", { id: collectionId });
}

export async function addGroupToCollection(
  client: OutlineHttpClient,
  collectionId: string,
  groupId: string,
  permission: OutlinePermission,
): Promise<void> {
  await client.request("collections.add_group", {
    id: collectionId,
    groupId,
    permission,
  });
}
