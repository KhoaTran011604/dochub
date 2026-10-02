import { getDocumentInfo, OutlineNotFoundError, type OutlineHttpClient } from "@hd-document/outline-api-client";
import { notFound } from "../http/api-error.ts";
import {
  assertProjectKeyAllowed,
  type AuthenticatedServiceClient,
} from "../http/service-key-authentication-middleware.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";

export interface DocumentProjectScope {
  documentId: string;
  projectKey: string;
}

/**
 * Không tin `documentId` do ERP gửi: tra `documents.info` lấy `collectionId`
 * THẬT từ Outline rồi map ngược ra `projectKey` qua `project_collection_map`,
 * sau đó kiểm phạm vi dự án của service key. Xem phase-04, mục Security
 * Considerations.
 */
export async function resolveDocumentProjectScope(
  outlineClient: OutlineHttpClient,
  mapRepository: ProjectCollectionMapRepository,
  serviceClient: AuthenticatedServiceClient,
  documentId: string,
): Promise<DocumentProjectScope> {
  let info;
  try {
    info = await getDocumentInfo(outlineClient, documentId);
  } catch (error) {
    if (error instanceof OutlineNotFoundError) {
      throw notFound("DOCUMENT_NOT_FOUND", `Document "${documentId}" does not exist in Outline.`);
    }
    throw error;
  }

  const map = await mapRepository.findByCollectionId(info.collectionId);
  if (!map) {
    throw notFound(
      "DOCUMENT_NOT_IN_SCOPE",
      `Document "${documentId}" is not in a project managed by this API.`,
    );
  }
  assertProjectKeyAllowed(serviceClient, map.projectKey);
  return { documentId: info.id, projectKey: map.projectKey };
}
