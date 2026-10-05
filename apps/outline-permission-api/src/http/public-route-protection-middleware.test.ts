import Router from "@koa/router";
import Koa from "koa";
import { describe, expect, it } from "vitest";
import { createPublicRouteProtectionMiddlewares } from "./public-route-protection-middleware.ts";

async function run(requests: string[], options: { maxRequests: number }) {
  const lines: string[] = [];
  const router = new Router();
  router.use(["/pending/:id"], ...createPublicRouteProtectionMiddlewares({ ...options, log: (l) => lines.push(l) }));
  router.get("/pending/:id", (ctx) => {
    ctx.body = "ok";
  });
  router.get("/healthz", (ctx) => {
    ctx.body = "up";
  });
  const app = new Koa();
  app.use(router.routes());
  const server = app.listen(0);
  const statuses: number[] = [];
  try {
    const { port } = server.address() as { port: number };
    for (const path of requests) statuses.push((await fetch(`http://127.0.0.1:${port}${path}`)).status);
  } finally {
    server.close();
  }
  return { statuses, lines };
}

describe("public route protection", () => {
  it("rate limits per IP with 429 after the limit; routes outside the list (healthz) are not limited", async () => {
    const { statuses } = await run(["/pending/a", "/pending/b", "/pending/c", "/healthz", "/healthz", "/healthz"], {
      maxRequests: 2,
    });
    expect(statuses).toEqual([200, 200, 429, 200, 200, 200]);
  });

  it("logs the route pattern, not the secret path", async () => {
    const { lines } = await run(["/pending/SECRET-ID"], { maxRequests: 5 });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ type: "public_route_access", route: "/pending/:id", status: 200, method: "GET" });
    expect(lines[0]).not.toContain("SECRET-ID");
  });
});
