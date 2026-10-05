import type { OutlineHttpClient } from "@hd-document/outline-api-client";
import { describe, expect, it, vi } from "vitest";
import type { MailerService } from "../mail/mailer.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import { createSetDocumentMemberPermissionService } from "./set-document-member-permission-service.ts";

const DOC = "11111111-1111-4111-8111-111111111111";

function build() {
  const request = vi.fn(async (method: string) => {
    if (method === "documents.info") return { id: DOC, collectionId: "col-1" };
    if (method === "documents.memberships") {
      return {
        memberships: [
          { userId: "ou-1", permission: "read_write" },
          { userId: "ou-ext", permission: "read" },
          { userId: "ou-admin", permission: "read" },
        ],
      };
    }
    if (method === "users.list") {
      return [
        { id: "ou-ext", name: "Ext", email: "ext@yopmail.com" },
        { id: "ou-admin", name: "Sys", email: "admin@sys.dev" },
      ];
    }
    return {};
  });
  const erpUserRepository = {
    findByOutlineUserIds: vi.fn(async () => [
      { erpUserId: "erp-1", email: "a@test.dev", displayName: "A", outlineUserId: "ou-1", status: "active" as const },
    ]),
  } as unknown as ErpUserRepository;
  const mapRepository = {
    findByCollectionId: async () => ({ projectKey: "prj-1" }),
  } as unknown as ProjectCollectionMapRepository;
  const service = createSetDocumentMemberPermissionService({
    outlineClient: { request } as unknown as OutlineHttpClient,
    mapRepository,
    erpUserRepository,
    mailer: {} as MailerService,
    outlineUrl: "http://outline.test",
    systemAdminEmail: "admin@sys.dev",
  });
  return { service, request };
}

describe("listMembers", () => {
  it("maps ERP users, keeps external invitees, hides system admin", async () => {
    const { service } = build();
    const members = await service.listMembers({ projectKeys: ["*"] } as never, DOC);
    expect(members).toEqual([
      { erpUserId: "erp-1", email: "a@test.dev", name: "A", permission: "read_write" },
      { erpUserId: null, email: "ext@yopmail.com", name: "Ext", permission: "read" },
    ]);
  });
});
