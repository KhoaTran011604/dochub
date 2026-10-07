import { getDocumentContent, type OutlineHttpClient } from "@hd-document/outline-api-client";
import type { AuthenticatedServiceClient } from "../http/service-key-authentication-middleware.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import { resolveDocumentProjectScope } from "./resolve-document-project-scope.ts";

export interface DocumentContentView {
  title: string;
  text: string;
  url: string;
}

export interface GetDocumentContentService {
  /** Read-only — same project-scope check as the write endpoints, no permission mutation. */
  getContent(serviceClient: AuthenticatedServiceClient, documentId: string): Promise<DocumentContentView>;
}

export function createGetDocumentContentService(deps: {
  outlineClient: OutlineHttpClient;
  mapRepository: ProjectCollectionMapRepository;
  outlineUrl: string;
}): GetDocumentContentService {
  return {
    async getContent(serviceClient, documentId) {
      await resolveDocumentProjectScope(deps.outlineClient, deps.mapRepository, serviceClient, documentId);
      const doc = await getDocumentContent(deps.outlineClient, documentId);
      return { title: doc.title, text: doc.text, url: `${deps.outlineUrl}${doc.url}` };
    },
  };
}
