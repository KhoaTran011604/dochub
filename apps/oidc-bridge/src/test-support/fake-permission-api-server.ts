import { createServer } from "node:http";
import type pg from "pg";
import { findFreeTcpPort } from "./find-free-tcp-port.ts";

export const FAKE_PERMISSION_API_SERVICE_KEY =
  "hdk_fake0000000000_0123456789abcdef0123456789abcdef";

export interface FakePermissionApi {
  baseUrl: string;
  /** Request kế tiếp trả lỗi này thay vì tạo user (đặt lại sau mỗi request). */
  nextError: { status: number; code: string } | undefined;
  /** Body của các lần PUT /users/:id đã nhận, theo thứ tự. */
  received: { erpUserId: string; email: string; name: string }[];
  stop(): Promise<void>;
}

/**
 * Giả lập `PUT /users/{erpUserId}` của outline-permission-api cho test tích
 * hợp của bridge: kiểm service key rồi ghi thẳng `erp_users` bằng role owner
 * (như API thật làm, bỏ phần gọi Outline).
 */
export async function startFakePermissionApi(
  ownerPool: pg.Pool,
): Promise<FakePermissionApi> {
  const port = await findFreeTcpPort();
  const api: FakePermissionApi = {
    baseUrl: `http://127.0.0.1:${port}`,
    nextError: undefined,
    received: [],
    stop: () => Promise.resolve(),
  };

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        const match = request.url?.match(/^\/users\/([^/?]+)$/);
        const authorized =
          request.headers.authorization ===
          `Bearer ${FAKE_PERMISSION_API_SERVICE_KEY}`;
        const send = (status: number, body: unknown) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(body));
        };
        if (!authorized) {
          return send(401, { error: { code: "INVALID_SERVICE_KEY" } });
        }
        if (request.method !== "PUT" || !match?.[1]) {
          return send(404, { error: { code: "NOT_FOUND" } });
        }
        if (api.nextError) {
          const { status, code } = api.nextError;
          api.nextError = undefined;
          return send(status, { error: { code } });
        }
        const erpUserId = decodeURIComponent(match[1]);
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          email: string;
          name: string;
        };
        api.received.push({ erpUserId, ...body });
        await ownerPool.query(
          `INSERT INTO permission_api.erp_users (erp_user_id, email, display_name, status)
           VALUES ($1, $2, $3, 'active')
           ON CONFLICT (erp_user_id) DO UPDATE SET email = $2, display_name = $3`,
          [erpUserId, body.email, body.name],
        );
        send(200, { erpUserId, outlineUserId: "fake", status: "active" });
      })().catch((error: unknown) => {
        response.writeHead(500);
        response.end(String(error));
      });
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve),
  );
  api.stop = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return api;
}
