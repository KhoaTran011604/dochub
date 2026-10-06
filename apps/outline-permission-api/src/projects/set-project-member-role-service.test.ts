import type { OutlineHttpClient } from "@hd-document/outline-api-client";
import { describe, expect, it, vi } from "vitest";
import type { MailerService } from "../mail/mailer.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import type { ProjectCollectionMapRecord, ProjectCollectionMapRepository } from "./project-collection-map-repository.ts";
import { createSetProjectMemberRoleService } from "./set-project-member-role-service.ts";

const MAP: ProjectCollectionMapRecord = {
  projectKey: "acme-portal",
  collectionId: "collection-1",
  viewerGroupId: "group-viewer",
  editorGroupId: "group-editor",
  managerGroupId: "group-manager",
};

/** Outline giả: group ops ghi lại; users.list trả user theo `existingUsers`; users.invite tạo user mới. */
function createFakeOutlineClient(existingUsers: Array<{ id: string; email: string }> = []) {
  const calls: Array<{ method: string; body: object }> = [];
  const client: OutlineHttpClient = {
    request(method, body = {}) {
      calls.push({ method, body });
      if (method === "users.list") {
        const query = String((body as { query?: string }).query ?? "").toLowerCase();
        return Promise.resolve(existingUsers.filter((user) => user.email.toLowerCase() === query) as never);
      }
      if (method === "users.invite") {
        const invites = (body as { invites: Array<{ email: string }> }).invites;
        return Promise.resolve({ users: invites.map((invite) => ({ id: `new-${invite.email}`, email: invite.email })) } as never);
      }
      return Promise.resolve(undefined as never);
    },
  };
  return { client, calls };
}

function createFakeRepositories(map: ProjectCollectionMapRecord | undefined, outlineUserId: string | null) {
  const mapRepository: ProjectCollectionMapRepository = {
    findByProjectKey: () => Promise.resolve(map),
    findByCollectionId: () => Promise.resolve(undefined),
    insert: () => Promise.resolve(),
  };
  const erpUserRepository: ErpUserRepository = {
    findByOutlineUserIds: () => Promise.resolve([]),
    findByErpUserId: () =>
      Promise.resolve(
        outlineUserId === null
          ? undefined
          : { erpUserId: "erp-1", email: "a@test.dev", displayName: "A", outlineUserId, status: "active" as const },
      ),
    insert: (): Promise<never> => {
      throw new Error("not used");
    },
    updateProfile: (): Promise<never> => {
      throw new Error("not used");
    },
    setStatus: () => Promise.resolve(),
  };
  return { mapRepository, erpUserRepository };
}

function createService(
  client: OutlineHttpClient,
  options: { map?: ProjectCollectionMapRecord; outlineUserId?: string | null } = {},
) {
  const map = "map" in options ? options.map : MAP;
  const outlineUserId = "outlineUserId" in options ? (options.outlineUserId ?? null) : "outline-user-1";
  const sendCollectionInviteEmail = vi.fn<MailerService["sendCollectionInviteEmail"]>();
  const mailer: MailerService = { sendDocumentInviteEmail: vi.fn(), sendCollectionInviteEmail };
  const service = createSetProjectMemberRoleService({
    outlineClient: client,
    ...createFakeRepositories(map, outlineUserId),
    mailer,
    outlineUrl: "https://outline.test",
    systemAdminEmail: "admin@test.dev",
  });
  return { service, sendCollectionInviteEmail };
}

const groupCalls = (calls: Array<{ method: string; body: object }>) =>
  calls.filter((call) => call.method.startsWith("groups.")).map((call) => `${call.method}:${JSON.stringify(call.body)}`);

describe("createSetProjectMemberRoleService", () => {
  it("setRole removes the user from the OTHER two groups before adding to the target group", async () => {
    const { client, calls } = createFakeOutlineClient();
    const { service } = createService(client);

    await service.setRole("acme-portal", "erp-1", "editor");

    expect(groupCalls(calls)).toEqual([
      `groups.remove_user:${JSON.stringify({ id: "group-viewer", userId: "outline-user-1" })}`,
      `groups.remove_user:${JSON.stringify({ id: "group-manager", userId: "outline-user-1" })}`,
      `groups.add_user:${JSON.stringify({ id: "group-editor", userId: "outline-user-1" })}`,
    ]);
  });

  it("removeMember removes the user from all three role groups", async () => {
    const { client, calls } = createFakeOutlineClient();
    const { service } = createService(client);

    await service.removeMember("acme-portal", "erp-1");

    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.method === "groups.remove_user")).toBe(true);
  });

  it("throws PROJECT_NOT_FOUND when the project has no collection map yet", async () => {
    const { client } = createFakeOutlineClient();
    const { service } = createService(client, { map: undefined });

    await expect(service.setRole("missing-project", "erp-1", "viewer")).rejects.toMatchObject({
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
  });

  it("throws USER_NOT_IN_OUTLINE when the ERP user has no Outline account yet", async () => {
    const { client } = createFakeOutlineClient();
    const { service } = createService(client, { outlineUserId: null });

    await expect(service.setRole("acme-portal", "erp-1", "viewer")).rejects.toMatchObject({
      status: 404,
      code: "USER_NOT_IN_OUTLINE",
    });
  });

  it("setRoleByEmail reuses an existing Outline user, applies the role and emails the collection link", async () => {
    const { client, calls } = createFakeOutlineClient([{ id: "ou-9", email: "guest@test.dev" }]);
    const { service, sendCollectionInviteEmail } = createService(client);

    await service.setRoleByEmail("acme-portal", "guest@test.dev", "viewer");

    expect(calls.some((call) => call.method === "users.invite")).toBe(false);
    expect(groupCalls(calls).at(-1)).toBe(`groups.add_user:${JSON.stringify({ id: "group-viewer", userId: "ou-9" })}`);
    expect(sendCollectionInviteEmail).toHaveBeenCalledWith({
      toEmail: "guest@test.dev",
      collectionUrl: "https://outline.test/collection/collection-1",
      role: "viewer",
    });
  });

  it("setRoleByEmail invites an unknown email into Outline before granting the role", async () => {
    const { client, calls } = createFakeOutlineClient();
    const { service } = createService(client);

    await service.setRoleByEmail("acme-portal", "new@test.dev", "editor");

    expect(calls.find((call) => call.method === "users.invite")?.body).toMatchObject({ suppressEmail: true });
    expect(groupCalls(calls).at(-1)).toBe(
      `groups.add_user:${JSON.stringify({ id: "group-editor", userId: "new-new@test.dev" })}`,
    );
  });

  it("setRoleByEmail refuses the reserved system admin email", async () => {
    const { client } = createFakeOutlineClient();
    const { service } = createService(client);

    await expect(service.setRoleByEmail("acme-portal", "Admin@test.dev", "manager")).rejects.toMatchObject({
      code: "SYSTEM_ADMIN_EMAIL_RESERVED",
    });
  });

  it("removeMemberByEmail clears all role groups; unknown email is 404", async () => {
    const { client, calls } = createFakeOutlineClient([{ id: "ou-9", email: "guest@test.dev" }]);
    const { service } = createService(client);

    await service.removeMemberByEmail("acme-portal", "guest@test.dev");
    expect(groupCalls(calls)).toHaveLength(3);
    expect(groupCalls(calls).every((call) => call.startsWith("groups.remove_user"))).toBe(true);

    await expect(service.removeMemberByEmail("acme-portal", "nobody@test.dev")).rejects.toMatchObject({
      code: "USER_NOT_IN_OUTLINE",
    });
  });
});
