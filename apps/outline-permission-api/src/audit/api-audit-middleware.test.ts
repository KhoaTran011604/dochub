import Koa from "koa";
import { describe, expect, it } from "vitest";
import { addAuditDetails, createApiAuditMiddleware, type ApiAuditEntry } from "./api-audit-logger.ts";

async function call(handler: (ctx: Koa.Context) => void | Promise<void>) {
  const entries: ApiAuditEntry[] = [];
  const app = new Koa();
  app.silent = true;
  app.use((ctx, next) => {
    ctx.state.serviceClient = { id: "client-1" };
    ctx.state.requestId = "req-1";
    return next();
  });
  app.use(async (ctx, next) => {
    // Lỗi ném ra được audit ghi lại rồi ném tiếp; chặn ở đây để request vẫn trả về.
    try {
      await next();
    } catch {
      ctx.status = 500;
    }
  });
  app.use(createApiAuditMiddleware(async (entry) => void entries.push(entry)));
  app.use(async (ctx) => handler(ctx));
  const server = app.listen(0);
  try {
    const address = server.address() as { port: number };
    await fetch(`http://127.0.0.1:${address.port}/documents`, { method: "POST" });
  } finally {
    server.close();
  }
  return entries;
}

describe("createApiAuditMiddleware details", () => {
  it("records route-attached audit details on success", async () => {
    const entries = await call((ctx) => {
      addAuditDetails(ctx.state, { actingErpUserId: "u1", projectKey: "p1" });
      addAuditDetails(ctx.state, { documentId: "d1", resultStatus: 202 });
      ctx.status = 202;
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      outcome: "success",
      requestId: "req-1",
      detail: { actingErpUserId: "u1", projectKey: "p1", documentId: "d1", resultStatus: 202 },
    });
  });

  it("keeps details alongside the error message when the handler throws", async () => {
    const entries = await call((ctx) => {
      addAuditDetails(ctx.state, { actingErpUserId: "u1", projectKey: "p1" });
      throw new Error("boom");
    });
    expect(entries[0]).toMatchObject({
      outcome: "error",
      detail: { actingErpUserId: "u1", projectKey: "p1", message: "boom" },
    });
  });

  it("omits detail when the route attached none", async () => {
    const entries = await call((ctx) => {
      ctx.status = 200;
    });
    expect(entries[0]).not.toHaveProperty("detail");
  });
});
