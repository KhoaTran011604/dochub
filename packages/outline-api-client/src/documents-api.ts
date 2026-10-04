import type { OutlineHttpClient } from "./outline-http-client.ts";
import type { OutlineDocumentInfo, OutlinePermission } from "./outline-api-types.ts";

/** Dùng để kiểm `collectionId` của document khi cấp quyền mức node (không tin `documentId` do ERP gửi). */
export async function getDocumentInfo(
  client: OutlineHttpClient,
  documentId: string,
): Promise<OutlineDocumentInfo> {
  return client.request<OutlineDocumentInfo>("documents.info", { id: documentId });
}

export async function addUserToDocument(
  client: OutlineHttpClient,
  documentId: string,
  userId: string,
  permission: OutlinePermission,
  sendsEmail?: boolean,
): Promise<void> {
  await client.request("documents.add_user", { id: documentId, userId, permission, sendsEmail });
}

export async function removeUserFromDocument(
  client: OutlineHttpClient,
  documentId: string,
  userId: string,
): Promise<void> {
  await client.request("documents.remove_user", { id: documentId, userId });
}
