import type { OutlineHttpClient } from "./outline-http-client.ts";
import type {
  OutlineOAuthClient,
  OutlineOAuthClientCreateInput,
  OutlineOAuthClientUpdateInput,
} from "./outline-api-types.ts";

/** Outline không có `oauthClients.get` theo tên; tự lọc từ `list`. */
export async function listOAuthClients(
  client: OutlineHttpClient,
): Promise<OutlineOAuthClient[]> {
  return client.request<OutlineOAuthClient[]>("oauthClients.list", {
    limit: 100,
  });
}

export async function findOAuthClientByName(
  client: OutlineHttpClient,
  name: string,
): Promise<OutlineOAuthClient | undefined> {
  const clients = await listOAuthClients(client);
  return clients.find((item) => item.name === name);
}

/**
 * `clientSecret` trong response chỉ xuất hiện đúng 1 lần ở đây.
 * Không idempotent → `retry: false`: lỗi mơ hồ (timeout/network/5xx) không
 * tự retry, tránh tạo trùng client khi response bị mất nhưng request đã
 * thành công phía Outline. Chạy lại CLI sẽ tự phát hiện qua `findOAuthClientByName`.
 */
export async function createOAuthClient(
  client: OutlineHttpClient,
  input: OutlineOAuthClientCreateInput,
): Promise<OutlineOAuthClient> {
  return client.request<OutlineOAuthClient>("oauthClients.create", input, { retry: false });
}

export async function updateOAuthClient(
  client: OutlineHttpClient,
  input: OutlineOAuthClientUpdateInput,
): Promise<OutlineOAuthClient> {
  return client.request<OutlineOAuthClient>("oauthClients.update", input);
}
