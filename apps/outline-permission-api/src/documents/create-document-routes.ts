import type Router from "@koa/router";
import { z } from "zod";
import { addAuditDetails } from "../audit/api-audit-logger.ts";
import { badRequest } from "../http/api-error.ts";
import { assertProjectKeyAllowed, getServiceClient } from "../http/service-key-authentication-middleware.ts";
import { parseJsonBody } from "../http/validate-request-with-zod.ts";
import type { CreateDocumentAsUserService } from "./create-document-as-user-service.ts";

const createDocumentBodySchema = z.object({
  projectKey: z.string().min(1).max(100),
  actingErpUserId: z.uuid(),
  title: z.string().min(1).max(255),
  text: z.string().max(200_000),
  parentDocumentId: z.uuid().optional(),
  publish: z.boolean().default(true),
});

/** Header bắt buộc: ERP gửi lại cùng giá trị khi retry hoặc để hỏi trạng thái 202. */
const idempotencyKeySchema = z.string().min(1).max(200).regex(/^[\x21-\x7e]+$/);

export function registerCreateDocumentRoutes(
  router: Router,
  deps: { service: CreateDocumentAsUserService },
): void {
  router.post("/documents", async (ctx) => {
    const client = getServiceClient(ctx.state);
    const key = idempotencyKeySchema.safeParse(ctx.get("idempotency-key"));
    if (!key.success) {
      throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required (1-200 printable ASCII chars).");
    }
    const body = await parseJsonBody(ctx, createDocumentBodySchema);
    assertProjectKeyAllowed(client, body.projectKey);
    // Có mặt cả khi service ném lỗi (audit ghi kèm outcome).
    addAuditDetails(ctx.state, { actingErpUserId: body.actingErpUserId, projectKey: body.projectKey });

    const result = await deps.service.create(client.id, key.data, body);
    addAuditDetails(ctx.state, { documentId: result.documentId, resultStatus: result.status });
    ctx.status = result.status;
    ctx.body = result.body;
  });
}
