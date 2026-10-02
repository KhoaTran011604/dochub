import type pg from "pg";

export interface ProjectCollectionMapRecord {
  projectKey: string;
  collectionId: string;
  viewerGroupId: string;
  editorGroupId: string;
  managerGroupId: string;
}

interface ProjectCollectionMapRow {
  project_key: string;
  collection_id: string;
  viewer_group_id: string;
  editor_group_id: string;
  manager_group_id: string;
}

function toRecord(row: ProjectCollectionMapRow): ProjectCollectionMapRecord {
  return {
    projectKey: row.project_key,
    collectionId: row.collection_id,
    viewerGroupId: row.viewer_group_id,
    editorGroupId: row.editor_group_id,
    managerGroupId: row.manager_group_id,
  };
}

export interface ProjectCollectionMapRepository {
  findByProjectKey(projectKey: string): Promise<ProjectCollectionMapRecord | undefined>;
  /** Tra ngược khi cấp quyền mức node: `documents.info` → `collectionId` → `projectKey`. */
  findByCollectionId(collectionId: string): Promise<ProjectCollectionMapRecord | undefined>;
  insert(record: ProjectCollectionMapRecord): Promise<void>;
}

const SELECT_COLUMNS =
  "project_key, collection_id, viewer_group_id, editor_group_id, manager_group_id";

export function createProjectCollectionMapRepository(
  pool: pg.Pool,
): ProjectCollectionMapRepository {
  return {
    async findByProjectKey(projectKey) {
      const result = await pool.query<ProjectCollectionMapRow>(
        `SELECT ${SELECT_COLUMNS} FROM permission_api.project_collection_map WHERE project_key = $1`,
        [projectKey],
      );
      const row = result.rows[0];
      return row ? toRecord(row) : undefined;
    },

    async findByCollectionId(collectionId) {
      const result = await pool.query<ProjectCollectionMapRow>(
        `SELECT ${SELECT_COLUMNS} FROM permission_api.project_collection_map WHERE collection_id = $1`,
        [collectionId],
      );
      const row = result.rows[0];
      return row ? toRecord(row) : undefined;
    },

    async insert(record) {
      await pool.query(
        `INSERT INTO permission_api.project_collection_map
           (project_key, collection_id, viewer_group_id, editor_group_id, manager_group_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          record.projectKey,
          record.collectionId,
          record.viewerGroupId,
          record.editorGroupId,
          record.managerGroupId,
        ],
      );
    },
  };
}
