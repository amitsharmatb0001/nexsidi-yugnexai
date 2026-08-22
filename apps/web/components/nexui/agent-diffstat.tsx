"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useMemo, useState, type ReactNode } from "react";
import { FileIcon, type FileStatus } from "./file-icon";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

export interface DiffStatEntry {
  path: string;
  additions: number;
  deletions: number;
  status?: FileStatus;
  /** Marks a rename; the old path is shown struck through. */
  previousPath?: string;
  /** Suppresses the sparkbar and shows "binary" instead. */
  binary?: boolean;
}

export interface DiffStatTotals {
  files: number;
  additions: number;
  deletions: number;
}

export type DiffStatSort = "churn" | "path" | "additions" | "deletions";

/** Sums a changeset. Exported so a header can show totals without the list. */
export function totalsOf(entries: DiffStatEntry[]): DiffStatTotals {
  let additions = 0;
  let deletions = 0;
  for (const entry of entries) {
    additions += entry.additions;
    deletions += entry.deletions;
  }
  return { files: entries.length, additions, deletions };
}

/** Sorts a copy of the entries. `churn` is additions+deletions, descending. */
export function sortEntries(entries: DiffStatEntry[], sort: DiffStatSort): DiffStatEntry[] {
  const copy = [...entries];
  switch (sort) {
    case "path":
      return copy.sort((a, b) => a.path.localeCompare(b.path));
    case "additions":
      return copy.sort((a, b) => b.additions - a.additions || a.path.localeCompare(b.path));
    case "deletions":
      return copy.sort((a, b) => b.deletions - a.deletions || a.path.localeCompare(b.path));
    case "churn":
    default:
      return copy.sort(
        (a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path),
      );
  }
}

/**
 * Allocates a file's sparkbar into whole add/delete segments out of `width`.
 *
 * Scaled against the *largest* file's churn, not each file's own, so bar
 * length is comparable down the list — the point of the column is spotting
 * which file carries the change, which a per-row normalisation would destroy
 * by making every row full width.
 *
 * A file with any additions always gets at least one segment, so a one-line
 * change never renders as an empty bar.
 */
export function allocateBar(
  additions: number,
  deletions: number,
  maxChurn: number,
  width: number,
): { add: number; del: number } {
  const churn = additions + deletions;
  if (churn === 0 || maxChurn === 0 || width === 0) return { add: 0, del: 0 };

  const total = Math.max(1, Math.round((churn / maxChurn) * width));

  let add = Math.round((additions / churn) * total);
  // Never round a non-zero side away to nothing, and never claim a segment
  // for a side that contributed no lines.
  if (additions > 0 && add === 0) add = 1;
  if (additions === 0) add = 0;
  if (add > total) add = total;

  let del = total - add;
  if (deletions > 0 && del === 0 && total > 1) {
    del = 1;
    add = total - 1;
  }
  if (deletions === 0) del = 0;

  return { add, del };
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const rootClass = css({
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  color: theme.color.foreground,
  border: `1px solid ${theme.color.border}`,
  borderRadius: theme.radius.md,
  backgroundColor: theme.color.card,
  overflow: "hidden",
});

const summaryClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[3],
  padding: `${theme.space[2]} ${theme.space[3]}`,
  borderBottom: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.muted,
  flexWrap: "wrap",
});

const summaryTextClass = css({
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  fontVariantNumeric: "tabular-nums",
});

const countsClass = css({
  display: "inline-flex",
  gap: theme.space[2],
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  fontVariantNumeric: "tabular-nums",
  marginLeft: "auto",
});

const addTextClass = css({ color: theme.color.success });
const delTextClass = css({ color: theme.color.destructive });

const sortGroupClass = css({
  display: "inline-flex",
  gap: "2px",
  padding: "2px",
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.background,
});

const sortButtonClass = css({
  padding: `1px ${theme.space[1.5]}`,
  borderRadius: theme.radius.sm,
  border: "none",
  background: "transparent",
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.sans,
  fontSize: "0.6875rem",
  cursor: "pointer",
  transitionProperty: "background-color, color",
  transitionDuration: theme.duration.fast,
  "&:hover": { color: theme.color.foreground },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "1px" },
  '&[aria-pressed="true"]': { backgroundColor: theme.color.primary, color: theme.color.primaryForeground },
});

const listClass = css({ margin: 0, padding: 0, listStyle: "none", maxHeight: "24rem", overflowY: "auto" });

const rowClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  width: "100%",
  padding: `${theme.space[1.5]} ${theme.space[3]}`,
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  transitionProperty: "background-color",
  transitionDuration: theme.duration.fast,
  "&:hover": { backgroundColor: theme.color.muted },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "-2px" },
  '&[aria-current="true"]': { backgroundColor: theme.color.accent, color: theme.color.accentForeground },
});

const staticRowClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  padding: `${theme.space[1.5]} ${theme.space[3]}`,
});

const pathClass = css({
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  // Truncating a path from the left keeps the filename visible, which is the
  // part that identifies it; the leading directories are the disposable half.
  direction: "rtl",
  textAlign: "left",
});

const renameClass = css({
  color: theme.color.mutedForeground,
  textDecoration: "line-through",
  marginRight: theme.space[1],
});

const numbersClass = css({
  flexShrink: 0,
  fontFamily: theme.fontFamily.mono,
  fontSize: "0.6875rem",
  fontVariantNumeric: "tabular-nums",
  color: theme.color.mutedForeground,
  minWidth: "4.5rem",
  textAlign: "right",
});

const barClass = css({
  display: "inline-flex",
  gap: "1px",
  flexShrink: 0,
  alignItems: "center",
});

const segmentClass = css({ width: "5px", height: "9px", borderRadius: "1px" });

const binaryClass = css({
  flexShrink: 0,
  fontSize: "0.6875rem",
  color: theme.color.mutedForeground,
  fontStyle: "italic",
});

const emptyClass = css({
  padding: theme.space[4],
  color: theme.color.mutedForeground,
  fontSize: theme.fontSize.sm,
  textAlign: "center",
});

const STATUS_COLOR: Record<Exclude<FileStatus, "unchanged">, string> = {
  new: theme.color.success,
  modified: theme.color.warning,
  deleted: theme.color.destructive,
};

const statusDotClass = css({ flexShrink: 0, width: "6px", height: "6px", borderRadius: "9999px" });

const SORTS: Array<{ id: DiffStatSort; label: string }> = [
  { id: "churn", label: "Churn" },
  { id: "path", label: "Path" },
  { id: "additions", label: "+" },
  { id: "deletions", label: "−" },
];

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface AgentDiffstatProps {
  entries: DiffStatEntry[];
  /** Number of segments in the widest sparkbar. */
  barWidth?: number;
  defaultSort?: DiffStatSort;
  /** Hides the sort control when false. */
  sortable?: boolean;
  /** Path of the row to mark as current. */
  selected?: string;
  onSelect?: (path: string) => void;
  /** Replaces the built-in summary line. */
  summary?: ReactNode;
  label?: string;
  className?: string;
}

/**
 * The changeset summary: totals plus a per-file add/delete sparkbar.
 *
 * Answers "what am I about to accept" in one glance, and pairs with
 * review-gate — a reviewer reads the shape of the change here, then decides
 * there.
 */
export function AgentDiffstat({
  entries,
  barWidth = 12,
  defaultSort = "churn",
  sortable = true,
  selected,
  onSelect,
  summary,
  label = "Changeset summary",
  className,
}: AgentDiffstatProps) {
  const [sort, setSort] = useState<DiffStatSort>(defaultSort);

  const totals = useMemo(() => totalsOf(entries), [entries]);
  const sorted = useMemo(() => sortEntries(entries, sort), [entries, sort]);
  const maxChurn = useMemo(
    () => entries.reduce((max, e) => Math.max(max, e.additions + e.deletions), 0),
    [entries],
  );

  if (entries.length === 0) {
    return (
      <div className={className ? `${rootClass} ${className}` : rootClass} aria-label={label}>
        <div className={emptyClass}>No files changed.</div>
      </div>
    );
  }

  return (
    <div className={className ? `${rootClass} ${className}` : rootClass} aria-label={label}>
      <div className={summaryClass}>
        {summary ?? (
          <span className={summaryTextClass}>
            {totals.files} {totals.files === 1 ? "file" : "files"} changed
          </span>
        )}

        {sortable ? (
          <div className={sortGroupClass} role="group" aria-label="Sort files">
            {SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={sortButtonClass}
                aria-pressed={sort === option.id}
                aria-label={`Sort by ${option.id}`}
                onClick={() => setSort(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        <span className={countsClass}>
          <span className={addTextClass}>+{totals.additions}</span>
          <span className={delTextClass}>−{totals.deletions}</span>
        </span>
      </div>

      <ul className={listClass}>
        {sorted.map((entry) => {
          const { add, del } = allocateBar(entry.additions, entry.deletions, maxChurn, barWidth);
          const status = entry.status && entry.status !== "unchanged" ? entry.status : undefined;
          const isSelected = entry.path === selected;

          const inner = (
            <>
              <FileIcon filename={entry.path} size={14} />

              {status ? (
                <span
                  className={statusDotClass}
                  style={{ backgroundColor: STATUS_COLOR[status] }}
                  aria-hidden="true"
                />
              ) : null}

              <span className={pathClass} title={entry.path}>
                {/* Bidi isolate: with direction:rtl on the container, a path
                    beginning with punctuation would otherwise be reordered. */}
                {"⁦"}
                {entry.previousPath ? <span className={renameClass}>{entry.previousPath} →</span> : null}
                {entry.path}
                {"⁩"}
              </span>

              {entry.binary ? (
                <span className={binaryClass}>binary</span>
              ) : (
                <>
                  <span className={numbersClass}>
                    +{entry.additions} −{entry.deletions}
                  </span>
                  <span
                    className={barClass}
                    aria-label={`${entry.additions} additions, ${entry.deletions} deletions`}
                  >
                    {Array.from({ length: add }, (_, i) => (
                      <span
                        key={`a${i}`}
                        className={segmentClass}
                        style={{ backgroundColor: theme.color.success }}
                        aria-hidden="true"
                      />
                    ))}
                    {Array.from({ length: del }, (_, i) => (
                      <span
                        key={`d${i}`}
                        className={segmentClass}
                        style={{ backgroundColor: theme.color.destructive }}
                        aria-hidden="true"
                      />
                    ))}
                  </span>
                </>
              )}
            </>
          );

          return (
            <li key={entry.path}>
              {onSelect ? (
                <button
                  type="button"
                  className={rowClass}
                  aria-current={isSelected}
                  onClick={() => onSelect(entry.path)}
                >
                  {inner}
                </button>
              ) : (
                <div className={staticRowClass}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
