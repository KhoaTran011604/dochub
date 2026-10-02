import type Router from "@koa/router";
import { z } from "zod";
import { conflict } from "../http/api-error.ts";
import { parseJsonBody, parseUuidParam } from "../http/validate-request-with-zod.ts";
import { EmailAlreadyInUseError } from "./erp-user-repository.ts";
import type { SetErpUserActiveStateService } from "./set-erp-user-active-state-service.ts";
import type { UpsertErpUsersService } from "./upsert-erp-users-service.ts";

const MAX_BATCH_SIZE = 20;

const parseErpUserId = (raw: string | undefined) =>
  parseUuidParam(raw, "ERP_USER_ID_NOT_UUID", "erpUserId");

const upsertBodySchema = z.object({
  email: z.email(),
  name: z.string().min(1).max(200),
});

const batchUpsertBodySchema = z.object({
  users: z
    .array(z.object({ erpUserId: z.uuid(), email: z.email(), name: z.string().min(1).max(200) }))
    .min(1)
    .max(MAX_BATCH_SIZE),
});

export function registerUsersRoutes(
  router: Router,
  deps: {
    upsertService: UpsertErpUsersService;
    activeStateService: SetErpUserActiveStateService;
  },
): void {
  router.put("/users/:erpUserId", async (ctx) => {
    const erpUserId = parseErpUserId(ctx.params.erpUserId);
    const body = await parseJsonBody(ctx, upsertBodySchema);
    try {
      ctx.body = await deps.upsertService.upsertOne({
        erpUserId,
        email: body.email,
        name: body.name,
      });
    } catch (error) {
      if (error instanceof EmailAlreadyInUseError) {
        throw conflict("EMAIL_ALREADY_IN_USE", error.message);
      }
      throw error;
    }
  });

  router.post("/users/batch-upsert", async (ctx) => {
    const body = await parseJsonBody(ctx, batchUpsertBodySchema);
    const results = await deps.upsertService.upsertBatch(body.users);
    ctx.body = { results };
  });

  router.post("/users/:erpUserId/deactivate", async (ctx) => {
    const erpUserId = parseErpUserId(ctx.params.erpUserId);
    await deps.activeStateService.deactivate(erpUserId);
    ctx.body = { erpUserId, status: "deactivated" };
  });

  router.post("/users/:erpUserId/activate", async (ctx) => {
    const erpUserId = parseErpUserId(ctx.params.erpUserId);
    await deps.activeStateService.activate(erpUserId);
    ctx.body = { erpUserId, status: "active" };
  });
}
