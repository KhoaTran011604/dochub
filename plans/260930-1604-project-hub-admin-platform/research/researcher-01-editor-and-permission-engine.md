# Research: Editor & Permission Engine
**Date:** 2026-09-30 | **Topics:** Block Editor (Tiptap vs BlockNote) + Node-based ACL

---

## Topic 1: Tiptap vs BlockNote for Notion-Style Editor

### Architecture
- **Stack**: ProseMirror → Tiptap → BlockNote (abstraction layers)
- **BlockNote**: Built on Tiptap, abstracts block management, keyboard shortcuts, drag-drop reordering
- **Tiptap**: Lower-level control, no block abstraction, requires custom infrastructure

### Comparison

| Factor | BlockNote | Tiptap |
|--------|-----------|--------|
| **Time-to-ship** | Fast (blocks + collab built-in) | Slower (build block logic) |
| **Customization** | Opinionated (harder for deep custom UI) | Full control (abstractions manageable) |
| **JSON Storage** | Yes (block-based JSON) | Yes (ProseMirror JSON structure) |
| **Read-only Mode** | Has native read-only prop | Disable extensions/toolbar |
| **License** | MIT-like (open source) | MIT (open source) |
| **Maintenance** | Active (Velt sponsor) | Stable (widely adopted) |
| **React Support** | Strong TypeScript support | Strong TypeScript support |
| **Collab Support** | Built-in via Velt/Y.js | Via extensions (Hocuspocus) |

### PostgreSQL Storage
Both serialize to JSON columns naturally:
- BlockNote: Block array with type, props, content
- Tiptap: ProseMirror JSON schema (extensible)

**Recommendation**: **BlockNote for this greenfield project**. Fast path to Notion-style page editor with blocks, JSON storage, and read-only public view (disable editing mode). Switch to Tiptap only if deep UI customization becomes blocking after MVP.

---

## Topic 2: Node-Based ACL / Permission Inheritance (Project → Folder → Document)

### Real-World Patterns

**Notion Model:**
- Everything is a "block" (pages, text, images, etc.) stored in single Postgres table
- Blocks inherit permissions from parent block
- Tree-based: read child block requires read access to parent block
- Hierarchical & permissive (default allow via inheritance)

**BookStack Model:**
- 3-level hierarchy: role permissions → "everyone else" settings → role-specific content overrides
- Fine-grained per-content permissions override role defaults
- Traversal: role → content-level → inheritance

### Proven Postgres Schema Pattern

**Tables:**
```sql
-- Nodes (Project/Folder/Document)
nodes (id, parent_id, name, type)  -- adjacency list for tree

-- Explicit grants (sparse, only set where needed)
permissions (node_id, user_id, role)  -- viewer/editor/admin

-- Ancestor materialization (optional, for speed)
node_ancestors (node_id, ancestor_id, depth)  -- closure table
```

**Inheritance Query** (recursive CTE):
```sql
WITH RECURSIVE ancestors AS (
  SELECT id, parent_id FROM nodes WHERE id = $1  -- target node
  UNION ALL
  SELECT n.id, n.parent_id FROM nodes n
  JOIN ancestors a ON a.parent_id = n.id
  WHERE depth < 100  -- termination guard
)
SELECT DISTINCT ON (a.id) p.role
FROM ancestors a
LEFT JOIN permissions p ON p.node_id = a.id AND p.user_id = $2
WHERE p.role IS NOT NULL  -- first (closest) explicit grant wins
ORDER BY depth ASC
LIMIT 1;
```

### Known Pitfalls & Mitigations

1. **N+1 Recursive Queries**: Materialized path (`'1/2/3'`) + closure table → O(1) ancestor lookup
2. **Move Node Access Leak**: When moving to new parent, re-validate entire ancestor chain (new restrictions may apply)
3. **Link Sharing Leak**: Shared link must validate *entire* chain to node, not just direct parent (ancestor revoked access after grant)
4. **Cycles**: Use adjacency list + depth guard; closure table prevents cycles naturally
5. **Cache Invalidation**: Revoke permission on node X → invalidate cache for X and all descendants

### Real System Approaches
- **Notion**: Queries block-tree at read-time per request; uses sharding to distribute load
- **Docmost** (open): Likely similar recursive CTE walk-up + explicit grants table
- **Closure Table**: Pre-compute all ancestor pairs → avoid recursion entirely (trades write cost for read speed)

**Recommendation**: **Materialized path + closure table + single recursive CTE per request**. Store explicit grants in sparse `permissions` table. Pre-compute `node_ancestors` on tree mutations (insert/delete/move). Query: single CTE walk-up to first explicit grant. Cache result per (user, node) for 5-15 min with invalidation on permission/tree changes. Avoids N+1 and handles all pitfalls (move validation, link leaks, cycles).

---

## Unresolved Questions

1. **BookStack exact schema**: Public docs lack PostgreSQL implementation details (only high-level role architecture)
2. **Performance at scale**: No benchmarks found for >1M nodes with recursive queries + closure table maintenance cost tradeoff
3. **Caching layer**: Should permission cache live in app (Redis) or Postgres materialized view? TTL strategy?
4. **Concurrent mutations**: Moving node while querying permissions—locking strategy to prevent race conditions?

---

## Sources
- [BlockNote vs. Tiptap: Simplicity Meets Full Control](https://tiptap.dev/alternatives/blocknote-vs-tiptap)
- [Top Notion-Style WYSIWYG Editors for React - Wisp CMS](https://www.wisp.blog/blog/top-notion-style-wysiwyg-editors-for-react)
- [Exploring Notion's Data Model: Block-Based Architecture](https://www.notion.com/blog/data-model-behind-notion)
- [Roles and Permissions · BookStack](https://www.bookstackapp.com/docs/user/roles-and-permissions/)
- [Mastering Recursive CTEs in PostgreSQL](https://medium.com/@jovite.jeffrin.louie.a/day-14-mastering-recursive-ctes-in-postgresql-working-with-hierarchical-data-156edea058f0)
- [How to Write Recursive Queries with CTEs in PostgreSQL](https://oneuptime.com/blog/post/2026-01-22-postgresql-recursive-cte-queries/view)
