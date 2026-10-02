import type { Context } from "koa";
import { z, type ZodType } from "zod";
import { badRequest } from "./api-error.ts";

const MAX_BODY_BYTES = 256 * 1024;

async function readJsonBody(ctx: Context): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of ctx.req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw badRequest("BODY_TOO_LARGE", `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("INVALID_JSON", "Request body is not valid JSON.");
  }
}

/** Đọc + validate JSON body (giới hạn 256 KB) theo schema zod. Lỗi schema bị bắt ở error-handling-middleware. */
export async function parseJsonBody<T>(ctx: Context, schema: ZodType<T>): Promise<T> {
  const raw = await readJsonBody(ctx);
  return schema.parse(raw);
}

/** Validate route params (vd `erpUserId`, `projectKey`) theo schema zod. */
export function parseParams<T>(
  params: Record<string, string | undefined>,
  schema: ZodType<T>,
): T {
  return schema.parse(params);
}

/**
 * `erpUserId` ở mọi endpoint = `sub` của IdP thật, bắt buộc UUID (xem
 * phase-04, addendum 2026-10-02). Mã lỗi dùng chung cho mọi route tham chiếu
 * `erpUserId` là 1 phần hợp đồng API với ERP.
 */
export function parseUuidParam(raw: string | undefined, code: string, label: string): string {
  const result = z.uuid().safeParse(raw ?? "");
  if (!result.success) {
    throw badRequest(code, `"${label}" must be a UUID, got "${raw ?? ""}".`);
  }
  return result.data;
}
