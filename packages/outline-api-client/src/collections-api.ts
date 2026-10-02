import type { OutlineHttpClient } from "./outline-http-client.ts";
import type { OutlineCollection, OutlinePermission } from "./outline-api-types.ts";

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
