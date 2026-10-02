import { OutlineNotFoundError, type OutlineHttpClient } from "@hd-document/outline-api-client";
import { describe, expect, it } from "vitest";
import type { AuthenticatedServiceClient } from "../http/service-key-authentication-middleware.ts";
import type { ProjectCollectionMapRecord, ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import { resolveDocumentProjectScope } from "./resolve-document-project-scope.ts";

const MAP: ProjectCollectionMapRecord = {
  projectKey: "acme-portal",
  collectionId: "collection-1",
  viewerGroupId: "g1",
  editorGroupId: "g2",
  managerGroupId: "g3",
};

function fakeClient(collectionId: string | undefined): OutlineHttpClient {
  return {
    request(method) {
      if (method !== "documents.info") throw new Error(`unexpected method ${method}`);
      if (!collectionId) throw new OutlineNotFoundError("not found", method, 404);
      return Promise.resolve({ id: "doc-1", collectionId } as never);
    },
  };
}

function fakeMapRepository(map: ProjectCollectionMapRecord | undefined): ProjectCollectionMapRepository {
  return {
    findByProjectKey: () => Promise.resolve(undefined),
    findByCollectionId: (collectionId) => Promise.resolve(map?.collectionId === collectionId ? map : undefined),
    insert: () => Promise.resolve(),
  };
}

function client(projectKeys: string[]): AuthenticatedServiceClient {
  return { id: "client-1", name: "erp", scopes: [], projectKeys };
}

describe("resolveDocumentProjectScope", () => {
  it("resolves the projectKey when the document's collection is managed by this API", async () => {
    const scope = await resolveDocumentProjectScope(
      fakeClient("collection-1"),
      fakeMapRepository(MAP),
      client(["*"]),
      "doc-1",
    );
    expect(scope).toEqual({ documentId: "doc-1", projectKey: "acme-portal" });
  });

  it("throws DOCUMENT_NOT_FOUND when Outline has no such document", async () => {
    await expect(
      resolveDocumentProjectScope(fakeClient(undefined), fakeMapRepository(MAP), client(["*"]), "missing"),
    ).rejects.toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
  });

  it("throws DOCUMENT_NOT_IN_SCOPE when the collection has no project mapping", async () => {
    await expect(
      resolveDocumentProjectScope(fakeClient("unmapped-collection"), fakeMapRepository(MAP), client(["*"]), "doc-1"),
    ).rejects.toMatchObject({ status: 404, code: "DOCUMENT_NOT_IN_SCOPE" });
  });

  it("throws PROJECT_KEY_FORBIDDEN when the service key is not scoped to the project", async () => {
    await expect(
      resolveDocumentProjectScope(
        fakeClient("collection-1"),
        fakeMapRepository(MAP),
        client(["other-project"]),
        "doc-1",
      ),
    ).rejects.toMatchObject({ status: 403, code: "PROJECT_KEY_FORBIDDEN" });
  });
});
