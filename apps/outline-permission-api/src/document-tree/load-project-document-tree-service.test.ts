import { OutlineForbiddenError, OutlineUnauthorizedError, type OutlineNavigationNode } from "@hd-document/outline-api-client";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../http/api-error.ts";
import { createLoadProjectDocumentTreeService, MAX_TREE_NODES } from "./load-project-document-tree-service.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const node = (id: string, children: OutlineNavigationNode[] = []): OutlineNavigationNode => ({
  id,
  title: `Title ${id}`,
  url: `/doc/${id}`,
  children,
});

function setup(overrides: { token?: string | undefined; list?: () => Promise<OutlineNavigationNode[]> } = {}) {
  const grantDelete = vi.fn();
  const createConsentOnly = vi.fn().mockResolvedValue({ id: "req-1" });
  const getAccessToken = vi.fn().mockResolvedValue("token" in overrides ? overrides.token : "user-token");
  const list = vi.fn(overrides.list ?? (() => Promise.resolve([node("a", [node("a1", [node("a11")])]), node("b")])));
  const service = createLoadProjectDocumentTreeService({
    erpUserRepository: {
      findByErpUserId: vi.fn((id: string) => Promise.resolve(id === USER_ID ? { erpUserId: id, status: "active" } : undefined)),
    } as never,
    mapRepository: {
      findByProjectKey: vi.fn((key: string) => Promise.resolve(key === "p1" ? { projectKey: key, collectionId: "col-1" } : undefined)),
    } as never,
    pendingRepository: { createConsentOnly } as never,
    grantRepository: { delete: grantDelete } as never,
    getAccessToken,
    listCollectionDocumentsWithUserToken: list,
    outlineUrl: "http://outline",
    publicUrl: "http://api",
    pendingTtlDays: 7,
  });
  return { service, grantDelete, createConsentOnly, getAccessToken, list };
}

const base = { projectKey: "p1", actingErpUserId: USER_ID, depth: 2 };

describe("load project document tree", () => {
  it("asks for the read scope and maps only id/title/url, limited by depth", async () => {
    const { service, getAccessToken } = setup();
    const result = await service.load("svc", base);
    expect(getAccessToken).toHaveBeenCalledWith(USER_ID, "read");
    if (result.kind !== "tree") throw new Error("expected tree");
    const [a, b] = result.body.nodes;
    expect(a).toMatchObject({ id: "a", url: "http://outline/doc/a", parentDocumentId: null, hasMoreChildren: false });
    expect(a?.children[0]).toMatchObject({ id: "a1", parentDocumentId: "a", hasMoreChildren: true, children: [] });
    expect(b?.children).toEqual([]);
    expect(Object.keys(a ?? {}).sort()).toEqual(["children", "hasMoreChildren", "id", "parentDocumentId", "title", "url"]);
  });

  it("returns the level under parentDocumentId", async () => {
    const { service } = setup();
    const result = await service.load("svc", { ...base, parentDocumentId: "a1", depth: 1 });
    if (result.kind !== "tree") throw new Error("expected tree");
    expect(result.body.parentDocumentId).toBe("a1");
    expect(result.body.nodes.map((n) => [n.id, n.parentDocumentId])).toEqual([["a11", "a1"]]);
  });

  it("404 when parentDocumentId is not in the user's tree", async () => {
    const { service } = setup();
    await expect(service.load("svc", { ...base, parentDocumentId: "nope" })).rejects.toMatchObject({ status: 404 });
  });

  it("409-style grantUrl when the user has no (or too narrow) grant", async () => {
    const { service, createConsentOnly, list } = setup({ token: undefined });
    const result = await service.load("svc", base);
    expect(result).toEqual({ kind: "grant-required", grantUrl: "http://api/pending/req-1" });
    expect(createConsentOnly).toHaveBeenCalledWith(expect.objectContaining({ serviceClientId: "svc", erpUserId: USER_ID }));
    expect(list).not.toHaveBeenCalled();
  });

  it("drops the grant and asks again when Outline rejects the token", async () => {
    const { service, grantDelete } = setup({
      list: () => Promise.reject(new OutlineUnauthorizedError("unauthorized", "collections.documents", 401)),
    });
    expect((await service.load("svc", base)).kind).toBe("grant-required");
    expect(grantDelete).toHaveBeenCalledWith(USER_ID);
  });

  it("403 without leaking titles when the user cannot read the collection", async () => {
    const { service } = setup({
      list: () => Promise.reject(new OutlineForbiddenError("forbidden", "collections.documents", 403)),
    });
    const error = await service.load("svc", base).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "ACTING_USER_FORBIDDEN" });
  });

  it("404 for unknown user / project", async () => {
    const { service } = setup();
    await expect(service.load("svc", { ...base, actingErpUserId: "22222222-2222-4222-8222-222222222222" })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    await expect(service.load("svc", { ...base, projectKey: "zz" })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("truncates beyond the node budget", async () => {
    const many = Array.from({ length: MAX_TREE_NODES + 5 }, (_, i) => node(`n${i}`));
    const { service } = setup({ list: () => Promise.resolve(many) });
    const result = await service.load("svc", base);
    if (result.kind !== "tree") throw new Error("expected tree");
    expect(result.body.nodes).toHaveLength(MAX_TREE_NODES);
    expect(result.body.truncated).toBe(true);
  });
});
