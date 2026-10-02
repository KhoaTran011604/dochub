import type { OutlineHttpClient } from "@hd-document/outline-api-client";
import { describe, expect, it } from "vitest";
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

function createFakeOutlineClient(): { client: OutlineHttpClient; calls: Array<{ method: string; body: object }> } {
  const calls: Array<{ method: string; body: object }> = [];
  return {
    calls,
    client: {
      request(method, body = {}) {
        calls.push({ method, body });
        return Promise.resolve(undefined as never);
      },
    },
  };
}

function createFakeRepositories(map: ProjectCollectionMapRecord | undefined, outlineUserId: string | null) {
  const mapRepository: ProjectCollectionMapRepository = {
    findByProjectKey: () => Promise.resolve(map),
    findByCollectionId: () => Promise.resolve(undefined),
    insert: () => Promise.resolve(),
  };
  const erpUserRepository: ErpUserRepository = {
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

describe("createSetProjectMemberRoleService", () => {
  it("setRole removes the user from the OTHER two groups before adding to the target group", async () => {
    const { client, calls } = createFakeOutlineClient();
    const { mapRepository, erpUserRepository } = createFakeRepositories(MAP, "outline-user-1");
    const service = createSetProjectMemberRoleService({ outlineClient: client, mapRepository, erpUserRepository });

    await service.setRole("acme-portal", "erp-1", "editor");

    expect(calls.map((call) => `${call.method}:${JSON.stringify(call.body)}`)).toEqual([
      `groups.remove_user:${JSON.stringify({ id: "group-viewer", userId: "outline-user-1" })}`,
      `groups.remove_user:${JSON.stringify({ id: "group-manager", userId: "outline-user-1" })}`,
      `groups.add_user:${JSON.stringify({ id: "group-editor", userId: "outline-user-1" })}`,
    ]);
  });

  it("removeMember removes the user from all three role groups", async () => {
    const { client, calls } = createFakeOutlineClient();
    const { mapRepository, erpUserRepository } = createFakeRepositories(MAP, "outline-user-1");
    const service = createSetProjectMemberRoleService({ outlineClient: client, mapRepository, erpUserRepository });

    await service.removeMember("acme-portal", "erp-1");

    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.method === "groups.remove_user")).toBe(true);
  });

  it("throws PROJECT_NOT_FOUND when the project has no collection map yet", async () => {
    const { client } = createFakeOutlineClient();
    const { mapRepository, erpUserRepository } = createFakeRepositories(undefined, "outline-user-1");
    const service = createSetProjectMemberRoleService({ outlineClient: client, mapRepository, erpUserRepository });

    await expect(service.setRole("missing-project", "erp-1", "viewer")).rejects.toMatchObject({
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
  });

  it("throws USER_NOT_IN_OUTLINE when the ERP user has no Outline account yet", async () => {
    const { client } = createFakeOutlineClient();
    const { mapRepository, erpUserRepository } = createFakeRepositories(MAP, null);
    const service = createSetProjectMemberRoleService({ outlineClient: client, mapRepository, erpUserRepository });

    await expect(service.setRole("acme-portal", "erp-1", "viewer")).rejects.toMatchObject({
      status: 404,
      code: "USER_NOT_IN_OUTLINE",
    });
  });
});
