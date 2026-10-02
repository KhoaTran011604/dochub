import type { IncomingMessage } from "node:http";

const MAX_FORM_BODY_BYTES = 8 * 1024;

/**
 * Đọc body `application/x-www-form-urlencoded` của form đăng nhập (vài trăm
 * byte). Quá giới hạn hoặc sai content-type → undefined. Trường lặp lấy giá
 * trị đầu.
 */
export async function readUrlEncodedFormBody(
  request: IncomingMessage,
): Promise<Record<string, string> | undefined> {
  const contentType = request.headers["content-type"] ?? "";
  if (
    !contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")
  ) {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_FORM_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }

  const fields: Record<string, string> = {};
  for (const [name, value] of new URLSearchParams(
    Buffer.concat(chunks).toString("utf8"),
  )) {
    fields[name] ??= value;
  }
  return fields;
}
