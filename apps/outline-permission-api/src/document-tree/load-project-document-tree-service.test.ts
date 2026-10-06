import {
  OutlineForbiddenError,
  OutlineUnauthorizedError,
  type OutlineDocumentSummary,
  type OutlineNavigationNode,
} from "@hd-document/outline-api-client";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../http/api-error.ts";
import { createLoadProjectDocumentTreeService, MAX_TREE_NODES } from "./load-project-document-tree-service.ts";
import { MAX_SHARED_TREE_CALLS, type SharedDocumentsSource } from "./load-shared-documents-tree.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const node = (id: string, children: OutlineNavigationNode[] = []): OutlineNavigationNode => ({
  id,
  title: `Title ${id}`,
  url: `/doc/${id}`,
  children,
});

const doc = (id: string, collectionId: string, parentDocumentId: string | null = null): OutlineDocumentSummary => ({
  id,
  title: `Title ${id}`,
  url: `/doc/${id}`,
  collectionId,
  parentDocumentId,
});

function setup(
  overrides: {
    token?: string | undefined;
    list?: () => Promise<OutlineNavigationNode[]>;
    shared?: Partial<SharedDocumentsSource>;
  } = {},
) {
  const grantDelete = vi.fn();
  const createConsentOnly = vi.fn().mockResolvedValue({ id: "req-1" });
  const getAccessToken = vi.fn().mockResolvedValue("token" in overrides ? overrides.token : "user-token");
  const list = vi.fn(overrides.list ?? (() => Promise.resolve([node("a", [node("a1", [node("a11")])]), node("b")])));
  const shared: SharedDocumentsSource = {
    listSharedRoots: vi.fn(() => Promise.resolve([])),
    listChildren: vi.fn(() => Promise.resolve([])),
    getDocument: vi.fn(() => Promise.resolve(undefined)),
    ...overrides.shared,
  };
  const service = createLoadProjectDocumentTreeService({
    sharedDocumentsSourceWithUserToken: () => shared,
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
  return { service, grantDelete, createConsentOnly, getAccessToken, list, shared };
}

const forbiddenList = () => Promise.reject(new OutlineForbiddenError("forbidden", "collections.documents", 403));

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

  it("403 without leaking titles when the user has neither collection access nor shared nodes", async () => {
    const listSharedRoots = vi.fn(() => Promise.resolve([]));
    const { service } = setup({ list: forbiddenList, shared: { listSharedRoots } });
    const error = await service.load("svc", base).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "ACTING_USER_FORBIDDEN" });
    expect(listSharedRoots).toHaveBeenCalledTimes(1);
  });

  it("falls back to the nodes shared directly with the user (this collection only)", async () => {
    const children: Record<string, OutlineDocumentSummary[]> = {
      s1: [doc("s1a", "col-1", "s1"), doc("s1b", "col-1", "s1")],
      s1a: [doc("s1a1", "col-1", "s1a")],
    };
    const { service } = setup({
      list: forbiddenList,
      shared: {
        listSharedRoots: () => Promise.resolve([doc("s1", "col-1"), doc("other", "col-2"), doc("s1a", "col-1", "s1")]),
        listChildren: (id) => Promise.resolve(children[id] ?? []),
      },
    });
    const result = await service.load("svc", { ...base, depth: 1 });
    if (result.kind !== "tree") throw new Error("expected tree");
    // `other` thuộc collection khác; `s1a` là con của `s1` nên không lặp ở gốc.
    expect(result.body.nodes.map((n) => n.id)).toEqual(["s1"]);
    expect(result.body.nodes[0]).toMatchObject({ url: "http://outline/doc/s1", hasMoreChildren: true, children: [] });
  });

  it("fallback: level under a shared parent, 404 when the parent is not visible or in another project", async () => {
    const { service } = setup({
      list: forbiddenList,
      shared: {
        getDocument: (id) => Promise.resolve(id === "s1" ? doc("s1", "col-1") : id === "x" ? doc("x", "col-2") : undefined),
        listChildren: (id) => Promise.resolve(id === "s1" ? [doc("s1a", "col-1", "s1")] : []),
      },
    });
    const level = await service.load("svc", { ...base, parentDocumentId: "s1", depth: 1 });
    if (level.kind !== "tree") throw new Error("expected tree");
    expect(level.body.nodes.map((n) => [n.id, n.parentDocumentId, n.hasMoreChildren])).toEqual([["s1a", "s1", false]]);
    await expect(service.load("svc", { ...base, parentDocumentId: "x" })).rejects.toMatchObject({ code: "PARENT_DOCUMENT_NOT_FOUND" });
    await expect(service.load("svc", { ...base, parentDocumentId: "nope" })).rejects.toMatchObject({ code: "PARENT_DOCUMENT_NOT_FOUND" });
  });

  it("fallback: marks truncated when shared roots exceed the node budget or the call cap", async () => {
    const roots = Array.from({ length: MAX_TREE_NODES + 5 }, (_, i) => doc(`r${i}`, "col-1"));
    const listChildren = vi.fn(() => Promise.resolve([]));
    const { service } = setup({
      list: forbiddenList,
      shared: { listSharedRoots: () => Promise.resolve(roots), listChildren },
    });
    const result = await service.load("svc", { ...base, depth: 1 });
    if (result.kind !== "tree") throw new Error("expected tree");
    expect(result.body.nodes).toHaveLength(MAX_TREE_NODES);
    expect(result.body.truncated).toBe(true);
    // Fan-out bị chặn: không gọi documents.list cho cả 1000 node.
    expect(listChildren.mock.calls.length).toBe(MAX_SHARED_TREE_CALLS);
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
