import type { OutlineDocumentSummary, OutlineNavigationNode } from "@hd-document/outline-api-client";
import { notFound } from "../http/api-error.ts";

/**
 * Nguồn dữ liệu (gọi bằng token của user) cho user KHÔNG có quyền collection,
 * chỉ được chia sẻ từng node (`documents.add_user`). Outline tự cascade quyền
 * từ node cha xuống con cháu nên con cháu đọc được qua `documents.list`.
 */
export interface SharedDocumentsSource {
  /** Node được chia sẻ trực tiếp (mọi collection); caller lọc theo collection. */
  listSharedRoots(): Promise<OutlineDocumentSummary[]>;
  listChildren(parentDocumentId: string): Promise<OutlineDocumentSummary[]>;
  /** `undefined` khi user không thấy doc (403/404): không phân biệt để khỏi lộ. */
  getDocument(documentId: string): Promise<OutlineDocumentSummary | undefined>;
}

/** Mỗi node = 1 lần `documents.list`; chặn fan-out cho cây lớn (vượt → `truncated`). */
export const MAX_SHARED_TREE_CALLS = 200;

interface Budget {
  /** Node còn được phép trả. */
  nodes: number;
  /** Lần gọi `listChildren` còn được phép. */
  calls: number;
  truncated: boolean;
}

const toNavigationNode = (doc: OutlineDocumentSummary): OutlineNavigationNode => ({
  id: doc.id,
  title: doc.title,
  url: doc.url,
  children: [],
});

/** Cắt theo budget node; ghi nhận bị cắt. */
function take(docs: OutlineDocumentSummary[], budget: Budget): OutlineNavigationNode[] {
  if (docs.length > budget.nodes) budget.truncated = true;
  const nodes = docs.slice(0, Math.max(budget.nodes, 0)).map(toNavigationNode);
  budget.nodes -= nodes.length;
  return nodes;
}

/**
 * Nạp con cháu tới `levels` cấp dưới `nodes`. Cấp cuối (`levels === 1`) chỉ để
 * `mapLevel` biết `hasMoreChildren`, không tính vào budget node.
 */
async function expandLevels(
  source: SharedDocumentsSource,
  nodes: OutlineNavigationNode[],
  levels: number,
  budget: Budget,
): Promise<void> {
  if (levels <= 0) return;
  for (const node of nodes) {
    if (budget.calls <= 0) {
      budget.truncated = true;
      return;
    }
    budget.calls -= 1;
    const children = await source.listChildren(node.id);
    if (levels === 1) {
      node.children = children.map(toNavigationNode);
      continue;
    }
    node.children = take(children, budget);
    await expandLevels(source, node.children, levels - 1, budget);
  }
}

/**
 * Dựng cây chỉ gồm node user được chia sẻ trong `collectionId`, sâu `depth` cấp
 * (+1 cấp nữa để tính `hasMoreChildren`). `nodes` rỗng khi không có gì được chia sẻ.
 * Kết quả cùng dạng `collections.documents` để dùng chung `mapLevel`.
 */
export async function loadSharedDocumentsTree(
  source: SharedDocumentsSource,
  input: { collectionId: string; parentDocumentId?: string | undefined; depth: number; maxNodes: number },
): Promise<{ nodes: OutlineNavigationNode[]; truncated: boolean }> {
  const budget: Budget = { nodes: input.maxNodes, calls: MAX_SHARED_TREE_CALLS, truncated: false };
  let level: OutlineDocumentSummary[];
  if (input.parentDocumentId) {
    const parent = await source.getDocument(input.parentDocumentId);
    if (!parent || parent.collectionId !== input.collectionId) {
      throw notFound("PARENT_DOCUMENT_NOT_FOUND", `No document "${input.parentDocumentId}" in this project.`);
    }
    budget.calls -= 1;
    level = await source.listChildren(input.parentDocumentId);
  } else {
    const shared = (await source.listSharedRoots()).filter((doc) => doc.collectionId === input.collectionId);
    // Node được chia sẻ riêng nhưng cha nó cũng được chia sẻ: chỉ hiện dưới cha, không lặp ở gốc
    // (chỉ xét cha trực tiếp; tổ tiên xa hơn vẫn có thể lặp — chấp nhận, không lộ gì thêm).
    const ids = new Set(shared.map((doc) => doc.id));
    level = shared.filter((doc) => !doc.parentDocumentId || !ids.has(doc.parentDocumentId));
  }

  const nodes = take(level, budget);
  await expandLevels(source, nodes, input.depth, budget);
  return { nodes, truncated: budget.truncated };
}
