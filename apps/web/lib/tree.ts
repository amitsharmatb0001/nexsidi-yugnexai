
/** Node shape as returned by GET /api/artifacts/:projectId/tree. */
export interface ApiNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  lang?: string;
  children?: ApiNode[];
}

/**
 * Directories first, then alphabetical — the ordering every file explorer
 * uses, and the reason a deep tree stays scannable.
 */
export function sortNodes(nodes: ApiNode[]): ApiNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Directory paths to open by default: the spine down to the first real code.
 *
 * Two levels (e.g. backend/ and backend/src/) — enough that source is visible
 * on first paint without dumping hundreds of rows from a deep project.
 */
export const DEFAULT_EXPAND_DEPTH = 2;

export function defaultExpanded(nodes: ApiNode[], depth = 0): string[] {
  if (depth >= DEFAULT_EXPAND_DEPTH) return [];
  const out: string[] = [];
  for (const n of sortNodes(nodes)) {
    if (n.type !== "directory") continue;
    out.push(n.path);
    out.push(...defaultExpanded(n.children ?? [], depth + 1));
  }
  return out;
}

/** Finds a node anywhere in the tree by its exact path, depth-first. */
export function findNode(nodes: ApiNode[], path: string): ApiNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const found = findNode(n.children, path);
      if (found) return found;
    }
  }
  return null;
}
