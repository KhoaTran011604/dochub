import type { OutlineHttpClient } from "./outline-http-client.ts";
import type {
  OutlineInviteUsersInput,
  OutlineInviteUsersResult,
  OutlineUser,
} from "./outline-api-types.ts";

/**
 * `users.invite`: tối đa 20 invite/request, 50 request/giờ (xem phase-04, mục
 * Key Insights). Không idempotent (gọi lại có thể tạo invite mới) → `retry:
 * false`: lỗi mơ hồ (timeout/network/5xx) không tự thử lại.
 */
export async function inviteUsers(
  client: OutlineHttpClient,
  input: OutlineInviteUsersInput,
): Promise<OutlineInviteUsersResult> {
  return client.request<OutlineInviteUsersResult>("users.invite", input, {
    retry: false,
  });
}

export async function listUsers(
  client: OutlineHttpClient,
  params: { query?: string; limit?: number } = {},
): Promise<OutlineUser[]> {
  return client.request<OutlineUser[]>("users.list", { limit: 100, ...params });
}

/** `users.list` theo danh sách id (Outline không trả email trong `documents.memberships`). */
export async function listUsersByIds(client: OutlineHttpClient, ids: string[]): Promise<OutlineUser[]> {
  if (ids.length === 0) return [];
  return client.request<OutlineUser[]>("users.list", { ids, limit: 100 });
}

/** `users.list` lọc gần đúng theo `query`; so khớp email chính xác (không phân biệt hoa thường) ở đây. */
export async function findUserByEmail(
  client: OutlineHttpClient,
  email: string,
): Promise<OutlineUser | undefined> {
  const users = await listUsers(client, { query: email });
  const target = email.toLowerCase();
  return users.find((user) => user.email.toLowerCase() === target);
}

export async function suspendUser(
  client: OutlineHttpClient,
  userId: string,
): Promise<OutlineUser> {
  return client.request<OutlineUser>("users.suspend", { id: userId });
}

export async function activateUser(
  client: OutlineHttpClient,
  userId: string,
): Promise<OutlineUser> {
  return client.request<OutlineUser>("users.activate", { id: userId });
}
