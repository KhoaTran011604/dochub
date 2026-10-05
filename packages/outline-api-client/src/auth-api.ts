import type { OutlineHttpClient } from "./outline-http-client.ts";
import type { OutlineAuthInfo } from "./outline-api-types.ts";

/**
 * `auth.info` với token của user: cho biết token thuộc Outline user nào, để
 * kiểm danh tính sau khi đổi code (người bấm Đồng ý phải là acting user).
 */
export async function getAuthInfo(client: OutlineHttpClient): Promise<OutlineAuthInfo> {
  return client.request<OutlineAuthInfo>("auth.info");
}
