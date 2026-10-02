import type { OutlinePermission } from "@hd-document/outline-api-client";

export type ProjectRole = "viewer" | "editor" | "manager";

export const PROJECT_ROLES: readonly ProjectRole[] = ["viewer", "editor", "manager"];

/** Khớp `collections.add_group`/`documents.add_user`: `read | read_write | admin`. */
export const ROLE_TO_COLLECTION_PERMISSION: Record<ProjectRole, OutlinePermission> = {
  viewer: "read",
  editor: "read_write",
  manager: "admin",
};

export const PROJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function projectGroupName(projectKey: string, role: ProjectRole): string {
  return `${projectKey}-${role}`;
}

/** Ghi vào `groups.create({ externalId })` để tra ngược group theo dự án + role. */
export function projectGroupExternalId(projectKey: string, role: ProjectRole): string {
  return `${projectKey}:${role}`;
}
