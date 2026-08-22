"use client";

import { css, keyframes, themeVars as theme } from "@yugnex/core";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { FileIcon, type FileStatus } from "./file-icon";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

export interface FileNode {
  /** Full path, used as the node's identity: "src/app/page.tsx". */
  path: string;
  /** Directories may have children; files never do. */
  children?: FileNode[];
  status?: FileStatus;
  /** Overrides the label derived from `path`. */
  name?: string;
}

/** One row of the flattened, visible tree. */
interface FlatRow {
  node: FileNode;
  depth: number;
  isDir: boolean;
  expanded: boolean;
  name: string;
}

/**
 * Builds a tree from a flat path list — the shape a generator actually emits
 * ("here are the 40 files I touched"), rather than the nested shape a tree
 * needs. Directory nodes are synthesized from the path segments.
 */
export function buildFileTree(entries: Array<{ path: string; status?: FileStatus }>): FileNode[] {
  const roots: FileNode[] = [];
  const dirs = new Map<string, FileNode>();

  // Sort so a directory's children arrive together and in a stable order.
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));

  for (const entry of sorted) {
    const segments = entry.path.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    let parentChildren = roots;
    let prefix = "";

    for (let i = 0; i < segments.length - 1; i++) {
      prefix = prefix ? `${prefix}/${segments[i]}` : (segments[i] as string);
      let dir = dirs.get(prefix);
      if (!dir) {
        dir = { path: prefix, name: segments[i] as string, children: [] };
        dirs.set(prefix, dir);
        parentChildren.push(dir);
      }
      // A path segment can collide with a file added earlier; treat the
      // directory as authoritative and give it a children array either way.
      if (!dir.children) dir.children = [];
      parentChildren = dir.children;
    }

    parentChildren.push({
      path: entry.path,
      name: segments[segments.length - 1] as string,
      status: entry.status,
    });
  }

  // Directories first, then files, each alphabetical — the ordering every
  // file explorer uses, and the one that makes a deep tree scannable.
  const sortLevel = (nodes: FileNode[]): FileNode[] => {
    nodes.sort((a, b) => {
      const aDir = Boolean(a.children);
      const bDir = Boolean(b.children);
      if (aDir !== bDir) return aDir ? -1 : 1;
      return (a.name ?? a.path).localeCompare(b.name ?? b.path);
    });
    for (const node of nodes) if (node.children) sortLevel(node.children);
    return nodes;
  };

  return sortLevel(roots);
}

function labelOf(node: FileNode): string {
  return node.name ?? (node.path.split("/").pop() ?? node.path);
}

/** Walks the tree into the flat, ordered list of rows the DOM actually renders. */
function flatten(nodes: FileNode[], expanded: Set<string>, depth = 0, out: FlatRow[] = []): FlatRow[] {
  for (const node of nodes) {
    const isDir = Array.isArray(node.children);
    const isExpanded = isDir && expanded.has(node.path);
    out.push({ node, depth, isDir, expanded: isExpanded, name: labelOf(node) });
    if (isExpanded && node.children) flatten(node.children, expanded, depth + 1, out);
  }
  return out;
}

/** Every directory path in the tree — the default expanded set. */
function allDirPaths(nodes: FileNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.children) {
      out.push(node.path);
      allDirPaths(node.children, out);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const pulse = keyframes({
  "0%, 100%": { opacity: 1 },
  "50%": { opacity: 0.35 },
});

const rootClass = css({
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  color: theme.color.foreground,
  userSelect: "none",
  overflowY: "auto",
});

const rowClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[1.5],
  width: "100%",
  padding: `3px ${theme.space[2]}`,
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  borderRadius: theme.radius.sm,
  transitionProperty: "background-color",
  transitionDuration: theme.duration.fast,
  "&:hover": { backgroundColor: theme.color.muted },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "-2px" },
  '&[aria-selected="true"]': { backgroundColor: theme.color.accent, color: theme.color.accentForeground },
});

const chevronClass = css({
  flexShrink: 0,
  transitionProperty: "transform",
  transitionDuration: theme.duration.fast,
  transitionTimingFunction: theme.easing.standard,
  '[data-expanded="true"] > &': { transform: "rotate(90deg)" },
});

const spacerClass = css({ flexShrink: 0, width: "14px" });

const nameClass = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
  flex: 1,
});

const deletedNameClass = css({ textDecoration: "line-through", opacity: 0.6 });

const statusDotClass = css({
  flexShrink: 0,
  width: "6px",
  height: "6px",
  borderRadius: "9999px",
});

const writingDotClass = css({
  flexShrink: 0,
  width: "6px",
  height: "6px",
  borderRadius: "9999px",
  backgroundColor: theme.color.primary,
  animation: `${pulse} 1s ${theme.easing.standard} infinite`,
});

const STATUS_COLOR: Record<Exclude<FileStatus, "unchanged">, string> = {
  new: theme.color.success,
  modified: theme.color.warning,
  deleted: theme.color.destructive,
};

const STATUS_LABEL: Record<Exclude<FileStatus, "unchanged">, string> = {
  new: "new file",
  modified: "modified",
  deleted: "deleted",
};

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface FileTreeProps {
  nodes: FileNode[];
  /** Path of the selected file. */
  selected?: string;
  onSelect?: (path: string) => void;
  /**
   * Path currently being written to. Pulses, and its ancestors auto-expand so
   * the active file is never hidden inside a collapsed folder.
   */
  writingPath?: string;
  /** Directory paths open on first render. Defaults to every directory. */
  defaultExpanded?: string[];
  className?: string;
  /** Accessible name for the tree. */
  label?: string;
}

/**
 * A file explorer for generated changesets: per-node status, a live pulse on
 * the file being written, and full keyboard navigation.
 *
 * Rows are flattened before render rather than nested, so arrow-key movement
 * is index arithmetic over one list instead of a tree walk — and only visible
 * rows cost anything, which is what keeps a wide tree cheap.
 */
export function FileTree({
  nodes,
  selected,
  onSelect,
  writingPath,
  defaultExpanded,
  className,
  label = "Files",
}: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpanded ?? allDirPaths(nodes)),
  );
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // The file being written must be reachable, so its ancestors are treated as
  // expanded regardless of what the user collapsed — recollapsing a folder
  // out from under a live write would hide the thing the pulse points at.
  const effectiveExpanded = useMemo(() => {
    if (!writingPath) return expanded;
    const next = new Set(expanded);
    const segments = writingPath.split("/").filter(Boolean);
    let prefix = "";
    for (let i = 0; i < segments.length - 1; i++) {
      prefix = prefix ? `${prefix}/${segments[i]}` : (segments[i] as string);
      next.add(prefix);
    }
    return next;
  }, [expanded, writingPath]);

  const rows = useMemo(() => flatten(nodes, effectiveExpanded), [nodes, effectiveExpanded]);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const focusRow = useCallback((index: number) => {
    setFocusIndex(index);
    rowRefs.current[index]?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const row = rows[index];
    if (!row) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(Math.min(index + 1, rows.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(Math.max(index - 1, 0));
        break;
      case "ArrowRight":
        event.preventDefault();
        // Collapsed directory opens; already-open one steps into its first child.
        if (row.isDir && !row.expanded) toggle(row.node.path);
        else if (row.isDir) focusRow(Math.min(index + 1, rows.length - 1));
        break;
      case "ArrowLeft": {
        event.preventDefault();
        if (row.isDir && row.expanded) {
          toggle(row.node.path);
          break;
        }
        // Otherwise jump to the parent row — the nearest row above at a
        // shallower depth.
        for (let i = index - 1; i >= 0; i--) {
          const candidate = rows[i];
          if (candidate && candidate.depth < row.depth) {
            focusRow(i);
            break;
          }
        }
        break;
      }
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      default:
        break;
    }
  };

  const activate = (row: FlatRow) => {
    if (row.isDir) toggle(row.node.path);
    else onSelect?.(row.node.path);
  };

  return (
    <div
      role="tree"
      aria-label={label}
      className={className ? `${rootClass} ${className}` : rootClass}
    >
      {rows.map((row, index) => {
        const isWriting = row.node.path === writingPath;
        const status = row.node.status;
        const showStatus = !isWriting && status && status !== "unchanged";

        return (
          <div
            key={row.node.path}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={row.node.path === selected}
            aria-expanded={row.isDir ? row.expanded : undefined}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <button
              type="button"
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              // Roving tabindex: the tree is a single tab stop.
              tabIndex={index === focusIndex ? 0 : -1}
              data-expanded={row.isDir ? row.expanded : undefined}
              aria-selected={row.node.path === selected}
              className={rowClass}
              style={{ paddingLeft: `calc(${theme.space[2]} + ${row.depth} * 0.875rem)` }}
              onClick={() => {
                setFocusIndex(index);
                activate(row);
              }}
              onFocus={() => setFocusIndex(index)}
            >
              {row.isDir ? (
                <svg className={chevronClass} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M5.5 3.5L9 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <span className={spacerClass} />
              )}

              <FileIcon
                filename={row.node.path}
                variant={row.isDir ? (row.expanded ? "folder-open" : "folder") : "file"}
                size={15}
              />

              <span
                className={
                  status === "deleted" ? `${nameClass} ${deletedNameClass}` : nameClass
                }
              >
                {row.name}
              </span>

              {isWriting ? (
                <>
                  <span className={writingDotClass} aria-hidden="true" />
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                    writing
                  </span>
                </>
              ) : null}

              {showStatus ? (
                <>
                  <span
                    className={statusDotClass}
                    style={{ backgroundColor: STATUS_COLOR[status] }}
                    aria-hidden="true"
                  />
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                    {STATUS_LABEL[status]}
                  </span>
                </>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
