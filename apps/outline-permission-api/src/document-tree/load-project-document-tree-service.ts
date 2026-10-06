import {
  OutlineForbiddenError,
  OutlineNotFoundError,
  OutlineUnauthorizedError,
  type OutlineNavigationNode,
} from "@hd-document/outline-api-client";
import { forbidden, notFound } from "../http/api-error.ts";
import type { GetOutlineAccessTokenForUser } from "../outline-oauth/get-outline-access-token-for-user.ts";
import type { UserOutlineGrantRepository } from "../outline-oauth/user-outline-grant-repository.ts";
import type { PendingDocumentRequestRepository } from "../pending/pending-document-request-repository.ts";
import type { ProjectCollectionMapRepository } from "../projects/project-collection-map-repository.ts";
import type { ErpUserRepository } from "../users/erp-user-repository.ts";
import { loadSharedDocumentsTree, type SharedDocumentsSource } from "./load-shared-documents-tree.ts";

/** Scope OAuth Outline cần để đọc cây (`collections.documents`) bằng token user. */
export const TREE_READ_OUTLINE_SCOPE = "read";
/** Tổng node tối đa trong 1 response; vượt thì cắt và báo `truncated`. */
export const MAX_TREE_NODES = 1000;

export interface DocumentTreeNode {
  id: string;
  title: string;
  url: string;
  parentDocumentId: string | null;
  /** Có con nhưng chưa trả (hết `depth` hoặc bị cắt): gọi lại với `parentDocumentId` = id node này. */
  hasMoreChildren: boolean;
  children: DocumentTreeNode[];
}

export type LoadDocumentTreeResult =
  | { kind: "tree"; body: { projectKey: string; parentDocumentId: string | null; truncated: boolean; nodes: DocumentTreeNode[] } }
  /** User chưa đồng ý (hoặc grant cũ thiếu scope `read`): ERP đưa user mở `grantUrl`. */
  | { kind: "grant-required"; grantUrl: string };

export interface LoadProjectDocumentTreeInput {
  projectKey: string;
  actingErpUserId: string;
  parentDocumentId?: string | undefined;
  /** Số cấp trả về dưới điểm bắt đầu (>= 1). */
  depth: number;
}

export interface LoadProjectDocumentTreeService {
  load(serviceClientId: string, input: LoadProjectDocumentTreeInput): Promise<LoadDocumentTreeResult>;
}

function findNode(nodes: OutlineNavigationNode[], id: string): OutlineNavigationNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children ?? [], id);
    if (found) return found;
  }
  return undefined;
}

/** Chỉ copy id/title/url: mọi field khác của Outline (nội dung, icon...) không bao giờ ra ngoài. */
function mapLevel(
  nodes: OutlineNavigationNode[],
  parentDocumentId: string | null,
  depth: number,
  budget: { left: number; truncated: boolean },
  outlineUrl: string,
): DocumentTreeNode[] {
  const result: DocumentTreeNode[] = [];
  for (const node of nodes) {
    if (budget.left <= 0) {
      budget.truncated = true;
      break;
    }
    budget.left -= 1;
    const children = node.children ?? [];
    const expand = depth > 1;
    result.push({
      id: node.id,
      title: node.title,
      url: `${outlineUrl}${node.url}`,
      parentDocumentId,
      hasMoreChildren: !expand && children.length > 0,
      children: expand ? mapLevel(children, node.id, depth - 1, budget, outlineUrl) : [],
    });
  }
  return result;
}

export function createLoadProjectDocumentTreeService(deps: {
  erpUserRepository: ErpUserRepository;
  mapRepository: ProjectCollectionMapRepository;
  pendingRepository: PendingDocumentRequestRepository;
  grantRepository: UserOutlineGrantRepository;
  getAccessToken: GetOutlineAccessTokenForUser;
  listCollectionDocumentsWithUserToken: (accessToken: string, collectionId: string) => Promise<OutlineNavigationNode[]>;
  /** Fallback khi user không có quyền collection: chỉ các node được chia sẻ riêng. */
  sharedDocumentsSourceWithUserToken: (accessToken: string) => SharedDocumentsSource;
  /** `OUTLINE_URL` public để ghép `url` trả cho ERP. */
  outlineUrl: string;
  /** `PERMISSION_API_PUBLIC_URL`: gốc của grantUrl. */
  publicUrl: string;
  pendingTtlDays: number;
  now?: () => Date;
}): LoadProjectDocumentTreeService {
  const now = deps.now ?? (() => new Date());

  async function requireGrant(serviceClientId: string, erpUserId: string): Promise<LoadDocumentTreeResult> {
    const expiresAt = new Date(now().getTime() + deps.pendingTtlDays * 86_400_000);
    const pending = await deps.pendingRepository.createConsentOnly({ serviceClientId, erpUserId, expiresAt });
    return { kind: "grant-required", grantUrl: `${deps.publicUrl}/pending/${pending.id}` };
  }

  return {
    async load(serviceClientId, input) {
      const user = await deps.erpUserRepository.findByErpUserId(input.actingErpUserId);
      if (!user) throw notFound("USER_NOT_FOUND", `No ERP user "${input.actingErpUserId}".`);
      if (user.status !== "active") throw forbidden("USER_DEACTIVATED", "The acting user is deactivated.");
      const map = await deps.mapRepository.findByProjectKey(input.projectKey);
      if (!map) throw notFound("PROJECT_NOT_FOUND", `No project "${input.projectKey}".`);

      const accessToken = await deps.getAccessToken(user.erpUserId, TREE_READ_OUTLINE_SCOPE);
      if (!accessToken) return requireGrant(serviceClientId, user.erpUserId);

      let level: OutlineNavigationNode[];
      let sharedTruncated = false;
      try {
        const roots = await deps.listCollectionDocumentsWithUserToken(accessToken, map.collectionId);
        level = roots;
        if (input.parentDocumentId) {
          const parent = findNode(roots, input.parentDocumentId);
          // Cũng là kết quả khi node tồn tại nhưng user không thấy: không phân biệt để khỏi lộ.
          if (!parent) throw notFound("PARENT_DOCUMENT_NOT_FOUND", `No document "${input.parentDocumentId}" in this project.`);
          level = parent.children ?? [];
        }
      } catch (error) {
        // Outline từ chối token (bị thu hồi phía Outline): bỏ grant, user đồng ý lại.
        if (error instanceof OutlineUnauthorizedError) {
          await deps.grantRepository.delete(user.erpUserId);
          return requireGrant(serviceClientId, user.erpUserId);
        }
        if (!(error instanceof OutlineForbiddenError || error instanceof OutlineNotFoundError)) throw error;
        // Không có quyền collection: chỉ còn các node được chia sẻ riêng (documents.add_user).
        const shared = await loadSharedDocumentsTree(deps.sharedDocumentsSourceWithUserToken(accessToken), {
          collectionId: map.collectionId,
          parentDocumentId: input.parentDocumentId,
          depth: input.depth,
          maxNodes: MAX_TREE_NODES,
        });
        level = shared.nodes;
        sharedTruncated = shared.truncated;
        // Không được chia sẻ gì = không thuộc dự án: không lộ gì thêm.
        if (level.length === 0 && !input.parentDocumentId) {
          throw forbidden("ACTING_USER_FORBIDDEN", "The acting user is not allowed to read documents in this project.");
        }
      }
      const budget = { left: MAX_TREE_NODES, truncated: false };
      const nodes = mapLevel(level, input.parentDocumentId ?? null, input.depth, budget, deps.outlineUrl);
      return {
        kind: "tree",
        body: {
          projectKey: input.projectKey,
          parentDocumentId: input.parentDocumentId ?? null,
          truncated: budget.truncated || sharedTruncated,
          nodes,
        },
      };
    },
  };
}
