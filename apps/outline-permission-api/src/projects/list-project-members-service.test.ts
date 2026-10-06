import type { OutlineHttpClient } from "@hd-document/outline-api-client";
import { describe, expect, it, vi } from "vitest";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import { createListProjectMembersService } from "./list-project-members-service.ts";
import type { ProjectCollectionMapRepository } from "./project-collection-map-repository.ts";

const MAP = {
  projectKey: "p1",
  collectionId: "col-1",
  viewerGroupId: "g-viewer",
  editorGroupId: "g-editor",
  managerGroupId: "g-manager",
};

describe("list project members", () => {
  it("maps role groups to ERP users (highest role wins) and email-invited outsiders; reserved admin dropped", async () => {
    const membersByGroup: Record<string, string[]> = {
      "g-manager": ["ou-1", "ou-admin"],
      "g-editor": ["ou-2", "ou-1"],
      "g-viewer": ["ou-3", "ou-guest"],
    };
    const request = vi.fn((method: string, body: { id?: string; ids?: string[] }) => {
      if (method === "users.list") {
        // ou-admin không map ERP: email reserved → bị loại; ou-guest là người ngoài mời theo email.
        const known = [
          { id: "ou-admin", email: "admin@x", name: "Admin" },
          { id: "ou-guest", email: "guest@x", name: "Guest" },
        ];
        return Promise.resolve(known.filter((user) => body.ids?.includes(user.id)));
      }
      if (method !== "groups.memberships") return Promise.reject(new Error(method));
      return Promise.resolve({ users: (membersByGroup[body.id ?? ""] ?? []).map((id) => ({ id })) });
    });
    const erpUserRepository = {
      findByOutlineUserIds: vi.fn((ids: string[]) =>
        Promise.resolve(
          [
            { erpUserId: "e1", email: "a@x", displayName: "A", outlineUserId: "ou-1", status: "active" as const },
            { erpUserId: "e2", email: "b@x", displayName: "B", outlineUserId: "ou-2", status: "active" as const },
            { erpUserId: "e3", email: "c@x", displayName: "C", outlineUserId: "ou-3", status: "active" as const },
          ].filter((user) => ids.includes(user.outlineUserId)),
        ),
      ),
    } as unknown as ErpUserRepository;
    const service = createListProjectMembersService({
      outlineClient: { request } as unknown as OutlineHttpClient,
      mapRepository: { findByProjectKey: () => Promise.resolve(MAP) } as unknown as ProjectCollectionMapRepository,
      erpUserRepository,
      systemAdminEmail: "admin@x",
    });

    const members = await service.list("p1");
    expect(members.map((m) => [m.erpUserId, m.email, m.role])).toEqual([
      ["e1", "a@x", "manager"],
      ["e2", "b@x", "editor"],
      ["e3", "c@x", "viewer"],
      [null, "guest@x", "viewer"],
    ]);
  });

  it("404 for unknown project", async () => {
    const service = createListProjectMembersService({
      outlineClient: { request: vi.fn() } as OutlineHttpClient,
      mapRepository: { findByProjectKey: () => Promise.resolve(undefined) } as unknown as ProjectCollectionMapRepository,
      erpUserRepository: {} as ErpUserRepository,
    });
    await expect(service.list("zz")).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
