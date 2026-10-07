import type { OutlineHttpClient } from "./outline-http-client.ts";
import type {
  OutlineCreatedDocument,
  OutlineDocumentContent,
  OutlineDocumentCreateInput,
  OutlineDocumentInfo,
  OutlineDocumentSummary,
  OutlinePermission,
} from "./outline-api-types.ts";

const PAGE_SIZE = 100;
/** Chặn vòng lặp phân trang vô hạn nếu Outline trả trang không đổi. */
const MAX_PAGES = 50;

const toSummary = (doc: Partial<OutlineDocumentSummary> & { id: string }): OutlineDocumentSummary => ({
  id: doc.id,
  title: doc.title ?? "",
  url: doc.url ?? `/doc/${doc.id}`,
  collectionId: doc.collectionId ?? null,
  parentDocumentId: doc.parentDocumentId ?? null,
});

/** `documents.info` rút gọn để dựng cây (gọi bằng token user: Outline tự kiểm quyền). */
export async function getDocumentSummary(client: OutlineHttpClient, documentId: string): Promise<OutlineDocumentSummary> {
  const doc = await client.request<Partial<OutlineDocumentSummary> & { id: string }>("documents.info", { id: documentId });
  return toSummary(doc);
}

/**
 * Doc được chia sẻ TRỰC TIẾP cho chủ token (`userMemberships.list`, gọi bằng token
 * user, scope `read`). Outline chỉ trả share gốc (sourceId null); con cháu được
 * Outline tự cascade nên lấy tiếp bằng `listChildDocuments`.
 */
export async function listUserMembershipDocuments(client: OutlineHttpClient): Promise<OutlineDocumentSummary[]> {
  const all: OutlineDocumentSummary[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await client.request<{ documents?: Array<Partial<OutlineDocumentSummary> & { id: string }> }>(
      "userMemberships.list",
      { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    );
    const documents = result?.documents ?? [];
    all.push(...documents.map(toSummary));
    if (documents.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Doc con trực tiếp của `parentDocumentId` theo quyền của chủ token (`documents.list`).
 * Outline bỏ qua kiểm quyền collection khi user có membership trên node cha
 * ("membership escape"), nên dùng được cho user chỉ được chia sẻ từng node.
 */
export async function listChildDocuments(
  client: OutlineHttpClient,
  parentDocumentId: string,
): Promise<OutlineDocumentSummary[]> {
  const all: OutlineDocumentSummary[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const documents = await client.request<Array<Partial<OutlineDocumentSummary> & { id: string }>>("documents.list", {
      parentDocumentId,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });
    all.push(...(documents ?? []).map(toSummary));
    if ((documents ?? []).length < PAGE_SIZE) break;
  }
  return all;
}

/** Dùng để kiểm `collectionId` của document khi cấp quyền mức node (không tin `documentId` do ERP gửi). */
export async function getDocumentInfo(
  client: OutlineHttpClient,
  documentId: string,
): Promise<OutlineDocumentInfo> {
  return client.request<OutlineDocumentInfo>("documents.info", { id: documentId });
}

/** `documents.info` đầy đủ (kèm `text`) — dùng cho xem nhanh nội dung, không dùng để dựng cây. */
export async function getDocumentContent(
  client: OutlineHttpClient,
  documentId: string,
): Promise<OutlineDocumentContent> {
  const doc = await client.request<Partial<OutlineDocumentContent> & { id: string }>("documents.info", {
    id: documentId,
  });
  return {
    id: doc.id,
    title: doc.title ?? "",
    text: doc.text ?? "",
    url: doc.url ?? `/doc/${doc.id}`,
  };
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
