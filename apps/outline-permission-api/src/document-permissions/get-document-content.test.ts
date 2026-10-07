import type { OutlineHttpClient } from "@hd-document/outline-api-client";
import { describe, expect, it, vi } from "vitest";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import { createGetDocumentContentService } from "./get-document-content-service.ts";

const DOC = "11111111-1111-4111-8111-111111111111";

function build() {
  const request = vi.fn(async (method: string) => {
    if (method === "documents.info") {
      return { id: DOC, collectionId: "col-1", title: "Spec", text: "# Hello", url: "/doc/spec-abc" };
    }
    return {};
  });
  const mapRepository = {
    findByCollectionId: async () => ({ projectKey: "prj-1" }),
  } as unknown as ProjectCollectionMapRepository;
  const service = createGetDocumentContentService({
    outlineClient: { request } as unknown as OutlineHttpClient,
    mapRepository,
    outlineUrl: "http://outline.test",
  });
  return { service, request };
}

describe("getContent", () => {
  it("returns the document's markdown body with a full-origin url", async () => {
    const { service } = build();
    const content = await service.getContent({ projectKeys: ["*"] } as never, DOC);
    expect(content).toEqual({ title: "Spec", text: "# Hello", url: "http://outline.test/doc/spec-abc" });
  });

  it("rejects when the service key is not scoped to the document's project", async () => {
    const { service } = build();
    await expect(service.getContent({ projectKeys: ["other-prj"] } as never, DOC)).rejects.toThrow();
  });
});
