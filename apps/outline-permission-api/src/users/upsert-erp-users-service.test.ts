import type { OutlineHttpClient, OutlineUser } from "@hd-document/outline-api-client";
import { describe, expect, it } from "vitest";
import { EmailAlreadyInUseError, type ErpUserRecord, type ErpUserRepository } from "./erp-user-repository.ts";
import { createUpsertErpUsersService } from "./upsert-erp-users-service.ts";

const SYSTEM_ADMIN_EMAIL = "admin@hd.test";

function fakeOutlineClient(existingUsers: OutlineUser[] = []) {
  const calls: Array<{ method: string; body: object }> = [];
  let nextId = 1;
  const client: OutlineHttpClient = {
    request(method, body = {}) {
      calls.push({ method, body });
      if (method === "users.list") {
        const query = (body as { query?: string }).query?.toLowerCase();
        return Promise.resolve(
          existingUsers.filter((user) => !query || user.email.toLowerCase() === query) as never,
        );
      }
      if (method === "users.invite") {
        const invites = (body as { invites: Array<{ email: string; name: string }> }).invites;
        const users = invites.map((invite) => ({
          id: `outline-${nextId++}`,
          name: invite.name,
          email: invite.email,
          role: "member" as const,
          isSuspended: false,
        }));
        return Promise.resolve({ sent: invites.map((invite) => invite.email), users } as never);
      }
      throw new Error(`unexpected Outline method "${method}"`);
    },
  };
  return { client, calls };
}

function fakeRepository() {
  const rows = new Map<string, ErpUserRecord>();
  const repository: ErpUserRepository = {
    findByOutlineUserIds: (ids) => Promise.resolve([...rows.values()].filter((row) => row.outlineUserId && ids.includes(row.outlineUserId))),
    findByErpUserId: (erpUserId) => Promise.resolve(rows.get(erpUserId)),
    insert: (input) => {
      const emailTaken = [...rows.values()].some(
        (row) => row.email.toLowerCase() === input.email.toLowerCase(),
      );
      if (emailTaken) throw new EmailAlreadyInUseError(input.email);
      const record: ErpUserRecord = {
        erpUserId: input.erpUserId,
        email: input.email,
        displayName: input.displayName,
        outlineUserId: input.outlineUserId,
        status: "active",
      };
      rows.set(input.erpUserId, record);
      return Promise.resolve(record);
    },
    updateProfile: (erpUserId, email, displayName) => {
      const existing = rows.get(erpUserId);
      if (!existing) throw new Error("erp_users row not found");
      const updated = { ...existing, email, displayName };
      rows.set(erpUserId, updated);
      return Promise.resolve(updated);
    },
    setStatus: () => Promise.resolve(),
  };
  return { repository, rows };
}

describe("createUpsertErpUsersService", () => {
  it("rejects the system_admin email", async () => {
    const { client } = fakeOutlineClient();
    const { repository } = fakeRepository();
    const service = createUpsertErpUsersService({ repository, outlineClient: client, systemAdminEmail: SYSTEM_ADMIN_EMAIL });

    await expect(
      service.upsertOne({ erpUserId: "erp-1", email: SYSTEM_ADMIN_EMAIL, name: "Admin" }),
    ).rejects.toMatchObject({ status: 403, code: "SYSTEM_ADMIN_EMAIL_RESERVED" });
  });

  it("for a brand-new user: invites via Outline and stores the returned outlineUserId", async () => {
    const { client, calls } = fakeOutlineClient();
    const { repository, rows } = fakeRepository();
    const service = createUpsertErpUsersService({ repository, outlineClient: client, systemAdminEmail: SYSTEM_ADMIN_EMAIL });

    const result = await service.upsertOne({ erpUserId: "erp-1", email: "a@test.dev", name: "A" });

    expect(calls.map((call) => call.method)).toEqual(["users.list", "users.invite"]);
    expect(result).toEqual({ erpUserId: "erp-1", outlineUserId: "outline-1", status: "active" });
    expect(rows.get("erp-1")?.outlineUserId).toBe("outline-1");
  });

  it("reuses an existing Outline user found by email instead of inviting again", async () => {
    const { client, calls } = fakeOutlineClient([
      { id: "outline-existing", name: "A", email: "a@test.dev", role: "member", isSuspended: false },
    ]);
    const { repository } = fakeRepository();
    const service = createUpsertErpUsersService({ repository, outlineClient: client, systemAdminEmail: SYSTEM_ADMIN_EMAIL });

    const result = await service.upsertOne({ erpUserId: "erp-1", email: "a@test.dev", name: "A" });

    expect(calls.map((call) => call.method)).toEqual(["users.list"]);
    expect(result.outlineUserId).toBe("outline-existing");
  });

  it("for an ERP user already provisioned: only updates the DB, never calls Outline", async () => {
    const { client, calls } = fakeOutlineClient();
    const { repository } = fakeRepository();
    const service = createUpsertErpUsersService({ repository, outlineClient: client, systemAdminEmail: SYSTEM_ADMIN_EMAIL });
    await service.upsertOne({ erpUserId: "erp-1", email: "a@test.dev", name: "A" });
    calls.length = 0;

    const result = await service.upsertOne({ erpUserId: "erp-1", email: "a@test.dev", name: "A renamed" });

    expect(calls).toHaveLength(0);
    expect(result).toEqual({ erpUserId: "erp-1", outlineUserId: "outline-1", status: "active" });
  });

  it("batch: 1 invite call covers every new user, existing users are only updated", async () => {
    const { client, calls } = fakeOutlineClient();
    const { repository } = fakeRepository();
    const service = createUpsertErpUsersService({ repository, outlineClient: client, systemAdminEmail: SYSTEM_ADMIN_EMAIL });
    await service.upsertOne({ erpUserId: "erp-existing", email: "existing@test.dev", name: "Existing" });
    calls.length = 0;

    const results = await service.upsertBatch([
      { erpUserId: "erp-existing", email: "existing@test.dev", name: "Existing renamed" },
      { erpUserId: "erp-new-1", email: "new1@test.dev", name: "New 1" },
      { erpUserId: "erp-new-2", email: "new2@test.dev", name: "New 2" },
      { erpUserId: "erp-admin", email: SYSTEM_ADMIN_EMAIL, name: "Admin" },
    ]);

    expect(calls.filter((call) => call.method === "users.invite")).toHaveLength(1);
    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({ ok: true, erpUserId: "erp-existing", outlineUserId: "outline-1", status: "active" });
    expect(results[1]).toMatchObject({ ok: true, erpUserId: "erp-new-1", status: "active" });
    expect(results[2]).toMatchObject({ ok: true, erpUserId: "erp-new-2", status: "active" });
    expect(results[3]).toMatchObject({ ok: false, erpUserId: "erp-admin", error: { code: "SYSTEM_ADMIN_EMAIL_RESERVED" } });
  });
});
