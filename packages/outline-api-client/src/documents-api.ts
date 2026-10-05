import type { OutlineHttpClient } from "./outline-http-client.ts";
import type {
  OutlineCreatedDocument,
  OutlineDocumentCreateInput,
  OutlineDocumentInfo,
  OutlinePermission,
} from "./outline-api-types.ts";

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

export interface OutlineDocumentMembership {
  userId: string;
  permission: OutlinePermission;
}

export interface OutlineDocumentMemberships {
  memberships: OutlineDocumentMembership[];
  users: { id: string; name: string; email: string }[];
}

/** Quyền trực tiếp (user) trên 1 doc: `documents.memberships`, phân trang theo limit/offset. */
export async function listDocumentMemberships(
  client: OutlineHttpClient,
  documentId: string,
): Promise<OutlineDocumentMemberships> {
  const result = await client.request<Partial<OutlineDocumentMemberships>>("documents.memberships", {
    id: documentId,
    limit: 100,
  });
  return { memberships: result.memberships ?? [], users: result.users ?? [] };
}

/**
 * Gọi bằng client mang token của user thật (tác giả = chủ token). `retry: false`:
 * lỗi mơ hồ không tự gọi lại, caller tra `documents.info` theo `id` đã sinh.
 */
export async function createDocument(
  client: OutlineHttpClient,
  input: OutlineDocumentCreateInput,
): Promise<OutlineCreatedDocument> {
  return client.request<OutlineCreatedDocument>("documents.create", input, { retry: false });
}
