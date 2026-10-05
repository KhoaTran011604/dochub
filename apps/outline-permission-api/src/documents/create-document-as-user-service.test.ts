import { OutlineUnauthorizedError } from "@hd-document/outline-api-client";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../http/api-error.ts";
import type { GetOutlineAccessTokenForUser } from "../outline-oauth/get-outline-access-token-for-user.ts";
import type { UserOutlineGrantRepository } from "../outline-oauth/user-outline-grant-repository.ts";
import type { PendingDocumentPayload, PendingDocumentRequestRepository } from "../pending/pending-document-request-repository.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import {
  createCreateDocumentAsUserService,
  hashCreateDocumentRequest,
  type CreateDocumentInput,
} from "./create-document-as-user-service.ts";
import type { IdempotencyKeyRepository } from "./idempotency-key-repository.ts";

function fakeIdempotencyRepository() {
  const records = new Map<string, Map<string, { requestHash: string; documentId: string; responseStatus: number | null; responseBody: Record<string, unknown> | null }>>();

  const repository: IdempotencyKeyRepository = {
    async begin(serviceClientId, key, requestHash, newDocumentId) {
      if (!records.has(serviceClientId)) records.set(serviceClientId, new Map());
      const clientRecords = records.get(serviceClientId)!;
      const existing = clientRecords.get(key);
      if (existing) {
        return {
          requestHash: existing.requestHash,
          documentId: existing.documentId,
          responseStatus: existing.responseStatus,
          responseBody: existing.responseBody,
        };
      }
      const record = { requestHash, documentId: newDocumentId, responseStatus: null, responseBody: null };
      clientRecords.set(key, record);
      return { ...record };
    },
    async complete(serviceClientId, key, status, body) {
      const clientRecords = records.get(serviceClientId);
      if (clientRecords?.has(key)) {
        const record = clientRecords.get(key)!;
        record.responseStatus = status;
        record.responseBody = body;
      }
    },
    async discardUnfinished(serviceClientId, key) {
      const record = records.get(serviceClientId)?.get(key);
      if (record && record.responseStatus === null) records.get(serviceClientId)!.delete(key);
    },
    deleteCreatedBefore: async () => 0,
  };
  return { repository, records };
}

function fakePendingRepository() {
  const pending = new Map<string, { serviceClientId: string; idempotencyKey: string; erpUserId: string; payload: PendingDocumentPayload; documentId: string; expiresAt: Date; status: "pending" | "completed"; documentUrl: string | null; id: string }>();
  let nextId = 1;

  const repository: PendingDocumentRequestRepository = {
    async create(input) {
      const id = `pending-${nextId++}`;
      const record = { id, ...input, status: "pending" as const, documentUrl: null };
      pending.set(id, record);
      pending.set(`${input.serviceClientId}:${input.idempotencyKey}`, record);
      return { id, erpUserId: input.erpUserId, payload: input.payload, documentId: input.documentId, status: "pending", documentUrl: null, expiresAt: input.expiresAt };
    },
    async findById(id) {
      const record = pending.get(id);
      return record ? { id: record.id, erpUserId: record.erpUserId, payload: record.payload, documentId: record.documentId, status: record.status, documentUrl: record.documentUrl, expiresAt: record.expiresAt } : undefined;
    },
    async findByIdempotencyKey(serviceClientId, key) {
      const record = pending.get(`${serviceClientId}:${key}`);
      return record ? { id: record.id, erpUserId: record.erpUserId, payload: record.payload, documentId: record.documentId, status: record.status, documentUrl: record.documentUrl, expiresAt: record.expiresAt } : undefined;
    },
    startAuthorization: vi.fn(),
    claimByState: vi.fn(),
    markCompleted: vi.fn(),
    deleteFinishedBefore: vi.fn(),
    createConsentOnly: vi.fn(),
  };
  return { repository, pending };
}

function fakeErpUserRepository() {
  const users = new Map<string, { erpUserId: string; email: string; displayName: string; outlineUserId: string | null; status: "active" | "deactivated" }>();

  const repository: ErpUserRepository = {
    async findByErpUserId(erpUserId) {
      return users.get(erpUserId) ?? undefined;
    },
    findByOutlineUserIds: vi.fn(),
    insert: vi.fn(),
    updateProfile: vi.fn(),
    setStatus: vi.fn(),
  };
  return { repository, users };
}

function fakeMapRepository() {
  const maps = new Map<string, { projectKey: string; collectionId: string; viewerGroupId: string; editorGroupId: string; managerGroupId: string }>();

  const repository: ProjectCollectionMapRepository = {
    async findByProjectKey(projectKey) {
      return maps.get(projectKey) ?? undefined;
    },
    async findByCollectionId() {
      return undefined;
    },
    insert: vi.fn(),
  };
  return { repository, maps };
}

function fakeGrantRepository() {
  const repository: UserOutlineGrantRepository = {
    upsert: vi.fn(),
    delete: vi.fn(),
    withLockedGrant: vi.fn(),
  };
  return { repository };
}

describe("createCreateDocumentAsUserService", () => {
  const defaultDeps = () => {
    const idempotency = fakeIdempotencyRepository();
    const pending = fakePendingRepository();
    const user = fakeErpUserRepository();
    const map = fakeMapRepository();
    const grant = fakeGrantRepository();

    user.users.set("erp-user-1", { erpUserId: "erp-user-1", email: "user@test.dev", displayName: "User", outlineUserId: "outline-1", status: "active" });
    map.maps.set("proj-1", { projectKey: "proj-1", collectionId: "collection-1", viewerGroupId: "viewer-1", editorGroupId: "editor-1", managerGroupId: "manager-1" });

    return {
      idempotency,
      pending,
      user,
      map,
      grant,
      getAccessToken: vi.fn(),
      createDocumentWithUserToken: vi.fn(),
      assertParentInCollection: vi.fn(async () => undefined),
    };
  };

  describe("idempotency", () => {
    it("idempotent replay with 201 returns same result", async () => {
      const deps = defaultDeps();
      const input: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-user-1", title: "Doc", text: "Content", publish: false };
      const body = { documentId: "doc-1", url: "https://outline.test/doc/doc-1" };

      deps.getAccessToken.mockResolvedValue("token-1");
      deps.createDocumentWithUserToken.mockResolvedValue({ documentId: "doc-1", url: "https://outline.test/doc/doc-1" });

      const service = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
      });

      const result1 = await service.create("client-1", "idempotency-key-1", input);
      expect(result1.status).toBe(201);

      deps.getAccessToken.mockClear();
      deps.createDocumentWithUserToken.mockClear();

      const result2 = await service.create("client-1", "idempotency-key-1", input);
      expect(result2.status).toBe(201);
      expect(result2.body).toEqual(body);
      expect(deps.createDocumentWithUserToken).not.toHaveBeenCalled();
    });

    it("same key different body throws 409 conflict", async () => {
      const deps = defaultDeps();
      const input1: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-user-1", title: "Doc", text: "Content", publish: false };
      const input2: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-user-1", title: "Doc Different", text: "Content", publish: false };

      deps.getAccessToken.mockResolvedValue("token-1");
      deps.createDocumentWithUserToken.mockResolvedValue({ documentId: "doc-1", url: "https://outline.test/doc/doc-1" });

      const service = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
      });

      await service.create("client-1", "key-1", input1);

      await expect(service.create("client-1", "key-1", input2)).rejects.toMatchObject({
        status: 409,
        code: "IDEMPOTENCY_KEY_REUSED",
      });
    });
  });

  describe("access token flow", () => {
    it("with valid access token: creates document 201", async () => {
      const deps = defaultDeps();
      const input: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-user-1", title: "Doc", text: "Content", publish: false };

      deps.getAccessToken.mockResolvedValue("token-1");
      deps.createDocumentWithUserToken.mockResolvedValue({ documentId: "doc-1", url: "https://outline.test/doc/doc-1" });

      const service = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
      });

      const result = await service.create("client-1", "key-1", input);

      expect(result.status).toBe(201);
      expect(result.body).toEqual({ documentId: "doc-1", url: "https://outline.test/doc/doc-1" });
      expect(deps.createDocumentWithUserToken).toHaveBeenCalledWith({
        accessToken: "token-1",
        collectionId: "collection-1",
        documentId: expect.any(String),
        payload: expect.objectContaining({ projectKey: "proj-1", title: "Doc" }),
      });
    });

    it("without access token: creates pending request 202", async () => {
      const deps = defaultDeps();
      const now = new Date("2024-01-15T12:00:00Z");
      const input: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-user-1", title: "Doc", text: "Content", publish: false };

      deps.getAccessToken.mockResolvedValue(undefined); // no grant yet

      const service = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
        now: () => now,
      });

      const result = await service.create("client-1", "key-1", input);

      expect(result.status).toBe(202);
      expect(result.body).toHaveProperty("requestId");
      expect(result.body).toHaveProperty("pendingUrl", expect.stringContaining("https://api.test/pending/"));
      expect(deps.createDocumentWithUserToken).not.toHaveBeenCalled();
    });

    it("Outline 403 on create: deletes grant and creates pending", async () => {
      const deps = defaultDeps();
      const input: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-user-1", title: "Doc", text: "Content", publish: false };

      deps.getAccessToken.mockResolvedValue("token-1");
      deps.createDocumentWithUserToken.mockRejectedValue(new OutlineUnauthorizedError("Unauthorized", "documents.create", 401));
      deps.grant.repository.delete = vi.fn().mockResolvedValue(undefined);

      const service = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
      });

      const result = await service.create("client-1", "key-1", input);

      expect(result.status).toBe(202);
      expect(deps.grant.repository.delete).toHaveBeenCalledWith("erp-user-1");
    });
  });

  describe("user validation", () => {
    it("user not found throws 404", async () => {
      const deps = defaultDeps();
      const input: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-unknown", title: "Doc", text: "Content", publish: false };

      const service = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
      });

      await expect(service.create("client-1", "key-1", input)).rejects.toMatchObject({
        status: 404,
        code: "USER_NOT_FOUND",
      });
    });

    it("deactivated user throws 403", async () => {
      const deps = defaultDeps();
      deps.user.users.set("erp-inactive", { erpUserId: "erp-inactive", email: "inactive@test.dev", displayName: "Inactive", outlineUserId: "outline-inactive", status: "deactivated" });
      const input: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-inactive", title: "Doc", text: "Content", publish: false };

      const service = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
      });

      await expect(service.create("client-1", "key-1", input)).rejects.toMatchObject({
        status: 403,
        code: "USER_DEACTIVATED",
      });
    });
  });

  describe("project validation", () => {
    it("project not found throws 404", async () => {
      const deps = defaultDeps();
      const input: CreateDocumentInput = { projectKey: "proj-unknown", actingErpUserId: "erp-user-1", title: "Doc", text: "Content", publish: false };

      const service = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
      });

      await expect(service.create("client-1", "key-1", input)).rejects.toMatchObject({
        status: 404,
        code: "PROJECT_NOT_FOUND",
      });
    });
  });

  describe("pending request expiration", () => {
    it("expired pending request replay throws 410", async () => {
      const deps = defaultDeps();
      const now = new Date("2024-01-15T12:00:00Z");
      const input: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-user-1", title: "Doc", text: "Content", publish: false };

      deps.getAccessToken.mockResolvedValue(undefined);

      const service = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
        now: () => now,
      });

      // First request creates pending
      const result1 = await service.create("client-1", "key-1", input);
      expect(result1.status).toBe(202);

      // Second request with expired time
      const laterTime = new Date("2024-01-16T13:00:00Z");
      const serviceExpired = createCreateDocumentAsUserService({
        erpUserRepository: deps.user.repository,
        mapRepository: deps.map.repository,
        idempotencyRepository: deps.idempotency.repository,
        pendingRepository: deps.pending.repository,
        grantRepository: deps.grant.repository,
        getAccessToken: deps.getAccessToken,
        createDocumentWithUserToken: deps.createDocumentWithUserToken,
        assertParentInCollection: deps.assertParentInCollection,
        publicUrl: "https://api.test",
        pendingTtlDays: 1,
        now: () => laterTime,
      });

      await expect(serviceExpired.create("client-1", "key-1", input)).rejects.toMatchObject({
        status: 410,
        code: "PENDING_REQUEST_EXPIRED",
      });
    });
  });

  describe("hash consistency", () => {
    it("same content produces same hash", () => {
      const input: CreateDocumentInput = {
        projectKey: "proj-1",
        actingErpUserId: "erp-user-1",
        title: "Title",
        text: "Text",
        parentDocumentId: "parent-1",
        publish: true,
      };

      const hash1 = hashCreateDocumentRequest(input);
      const hash2 = hashCreateDocumentRequest(input);

      expect(hash1).toBe(hash2);
    });

    it("different content produces different hash", () => {
      const input1: CreateDocumentInput = {
        projectKey: "proj-1",
        actingErpUserId: "erp-user-1",
        title: "Title",
        text: "Text",
        publish: true,
      };
      const input2: CreateDocumentInput = {
        projectKey: "proj-1",
        actingErpUserId: "erp-user-1",
        title: "Different Title",
        text: "Text",
        publish: true,
      };

      const hash1 = hashCreateDocumentRequest(input1);
      const hash2 = hashCreateDocumentRequest(input2);

      expect(hash1).not.toBe(hash2);
    });

    it("order of keys does not matter", () => {
      const input1: CreateDocumentInput = {
        projectKey: "proj-1",
        actingErpUserId: "erp-user-1",
        title: "Title",
        text: "Text",
        parentDocumentId: "parent-1",
        publish: true,
      };
      const input2: CreateDocumentInput = {
        actingErpUserId: "erp-user-1",
        projectKey: "proj-1",
        text: "Text",
        title: "Title",
        publish: true,
        parentDocumentId: "parent-1",
      };

      const hash1 = hashCreateDocumentRequest(input1);
      const hash2 = hashCreateDocumentRequest(input2);

      expect(hash1).toBe(hash2);
    });
  });
});

describe("createCreateDocumentAsUserService validation and cleanup", () => {
  const input: CreateDocumentInput = { projectKey: "proj-1", actingErpUserId: "erp-user-1", title: "Doc", text: "Content", parentDocumentId: "parent-1", publish: false };

  function build() {
    const idempotency = fakeIdempotencyRepository();
    const pending = fakePendingRepository();
    const user = fakeErpUserRepository();
    const map = fakeMapRepository();
    user.users.set("erp-user-1", { erpUserId: "erp-user-1", email: "u@test.dev", displayName: "U", outlineUserId: "o-1", status: "active" });
    map.maps.set("proj-1", { projectKey: "proj-1", collectionId: "collection-1", viewerGroupId: "v", editorGroupId: "e", managerGroupId: "m" });
    const getAccessToken = vi.fn<GetOutlineAccessTokenForUser>().mockResolvedValue(undefined);
    const assertParentInCollection = vi.fn(async (_parent: string, _collection: string) => undefined);
    const service = createCreateDocumentAsUserService({
      erpUserRepository: user.repository,
      mapRepository: map.repository,
      idempotencyRepository: idempotency.repository,
      pendingRepository: pending.repository,
      grantRepository: fakeGrantRepository().repository,
      getAccessToken,
      createDocumentWithUserToken: vi.fn(),
      assertParentInCollection,
      publicUrl: "https://api.test",
      pendingTtlDays: 1,
    });
    return { service, idempotency, user, map, assertParentInCollection };
  }

  it("validates parent before returning 202 and exposes documentId", async () => {
    const t = build();
    const result = await t.service.create("c1", "k1", input);
    expect(result.status).toBe(202);
    expect(result.documentId).toBeTruthy();
    expect(t.assertParentInCollection).toHaveBeenCalledWith("parent-1", "collection-1");
  });

  it("invalid parent -> error, no pending row, idempotency row deleted so corrected retry works", async () => {
    const t = build();
    t.assertParentInCollection.mockRejectedValueOnce(new ApiError(400, "PARENT_DOCUMENT_WRONG_PROJECT", "bad"));
    await expect(t.service.create("c1", "k1", input)).rejects.toMatchObject({ code: "PARENT_DOCUMENT_WRONG_PROJECT" });
    expect(t.idempotency.records.get("c1")?.has("k1")).toBe(false);
    const retry = await t.service.create("c1", "k1", { ...input, parentDocumentId: "parent-2" });
    expect(retry.status).toBe(202);
  });

  it.each([
    ["USER_NOT_FOUND", (t: ReturnType<typeof build>) => t.user.users.delete("erp-user-1")],
    ["USER_DEACTIVATED", (t: ReturnType<typeof build>) => { t.user.users.get("erp-user-1")!.status = "deactivated"; }],
    ["PROJECT_NOT_FOUND", (t: ReturnType<typeof build>) => t.map.maps.delete("proj-1")],
  ])("%s deletes the unfinished idempotency row", async (code, breakIt) => {
    const t = build();
    breakIt(t);
    await expect(t.service.create("c1", "k1", input)).rejects.toMatchObject({ code });
    expect(t.idempotency.records.get("c1")?.has("k1")).toBe(false);
  });

  it("5xx/unknown errors keep the idempotency row (document id preserved for retry)", async () => {
    const t = build();
    t.assertParentInCollection.mockRejectedValueOnce(new ApiError(502, "OUTLINE_ADMIN_UNAUTHORIZED", "x"));
    await expect(t.service.create("c1", "k1", input)).rejects.toMatchObject({ status: 502 });
    expect(t.idempotency.records.get("c1")?.has("k1")).toBe(true);
  });
});
