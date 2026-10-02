import {
  addGroupToCollection,
  createCollection,
  createGroup,
  findGroupByExternalId,
  type OutlineGroup,
  type OutlineHttpClient,
} from "@hd-document/outline-api-client";
import {
  projectGroupExternalId,
  projectGroupName,
  ROLE_TO_COLLECTION_PERMISSION,
  type ProjectRole,
} from "./project-group-naming-convention.ts";
import type {
  ProjectCollectionMapRecord,
  ProjectCollectionMapRepository,
} from "./project-collection-map-repository.ts";

async function findOrCreateGroup(
  client: OutlineHttpClient,
  projectKey: string,
  role: ProjectRole,
): Promise<OutlineGroup> {
  const externalId = projectGroupExternalId(projectKey, role);
  const existing = await findGroupByExternalId(client, externalId);
  if (existing) return existing;
  return createGroup(client, { name: projectGroupName(projectKey, role), externalId });
}

/**
 * Idempotent qua `project_collection_map`: có map row → coi là đã tạo xong
 * trọn vẹn, không gọi Outline. Thiếu map row → tra lại từng group theo
 * `externalId` trước khi tạo (phục hồi khi lần chạy trước crash giữa chừng).
 * Collection chỉ tạo mới, không tra lại (Outline không có field tra ngược cho
 * collection) — rủi ro tạo trùng chỉ xảy ra khi crash đúng lúc đó, chấp nhận
 * (xem phase-04, mục Risk Assessment).
 */
export async function ensureProjectCollectionAndGroups(
  client: OutlineHttpClient,
  mapRepository: ProjectCollectionMapRepository,
  projectKey: string,
  projectName: string,
): Promise<ProjectCollectionMapRecord> {
  const existing = await mapRepository.findByProjectKey(projectKey);
  if (existing) return existing;

  const [viewerGroup, editorGroup, managerGroup] = await Promise.all([
    findOrCreateGroup(client, projectKey, "viewer"),
    findOrCreateGroup(client, projectKey, "editor"),
    findOrCreateGroup(client, projectKey, "manager"),
  ]);
  const collection = await createCollection(client, { name: projectName, permission: null });

  await Promise.all([
    addGroupToCollection(client, collection.id, viewerGroup.id, ROLE_TO_COLLECTION_PERMISSION.viewer),
    addGroupToCollection(client, collection.id, editorGroup.id, ROLE_TO_COLLECTION_PERMISSION.editor),
    addGroupToCollection(client, collection.id, managerGroup.id, ROLE_TO_COLLECTION_PERMISSION.manager),
  ]);

  const record: ProjectCollectionMapRecord = {
    projectKey,
    collectionId: collection.id,
    viewerGroupId: viewerGroup.id,
    editorGroupId: editorGroup.id,
    managerGroupId: managerGroup.id,
  };
  await mapRepository.insert(record);
  return record;
}
