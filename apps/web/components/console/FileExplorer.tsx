"use client";

import { useState } from "react";
import s from "./console.module.css";

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

function Row({
  node,
  depth,
  expanded,
  selected,
  freshPaths,
  onToggle,
  onSelect,
}: {
  node: ApiNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  freshPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (node: ApiNode) => void;
}) {
  const isDir = node.type === "directory";
  const isOpen = expanded.has(node.path);
  const isFresh = freshPaths.has(node.path);

  return (
    <>
      <button
        type="button"
        onClick={() => (isDir ? onToggle(node.path) : onSelect(node))}
        className={[
          s.treeRow,
          selected === node.path ? s.treeRowSelected : "",
          isFresh && !isDir ? s.treeFresh : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: 12 + depth * 12 }}
        title={node.path}
      >
        <span className={s.treeCaret}>{isDir ? (isOpen ? "▾" : "▸") : ""}</span>
        <span className={`${s.treeIcon} nxi ${isDir ? (isOpen ? "nxi-folder-open" : "nxi-folder") : "nxi-file"}`} />
        <span className={`${s.treeName} ${isDir ? s.treeDir : ""}`}>{node.name}</span>
        {isFresh && !isDir && <span className={s.freshPip} aria-label="just written" />}
      </button>

      {isDir &&
        isOpen &&
        sortNodes(node.children ?? []).map((child) => (
          <Row
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selected={selected}
            freshPaths={freshPaths}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

export default function FileExplorer({
  tree,
  selected,
  freshPaths,
  onSelect,
}: {
  tree: ApiNode[];
  selected: string | null;
  /** Paths written recently by agents — rendered live-highlighted. */
  freshPaths: Set<string>;
  onSelect: (node: ApiNode) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpanded(tree)));

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  if (tree.length === 0) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>No files yet</div>
        <div className={s.emptyHint}>Generated source appears here as it is written.</div>
      </div>
    );
  }

  return (
    <div className={s.tree}>
      {sortNodes(tree).map((node) => (
        <Row
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          selected={selected}
          freshPaths={freshPaths}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
