"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useMemo, type ReactNode } from "react";
import { languageFromFilename, tokenizeLine, TokenLine, type ScanState, type SyntaxLanguage, type Token } from "./syntax";

/* ------------------------------------------------------------------ *
 * Myers diff
 * ------------------------------------------------------------------ */

export type EditKind = "equal" | "insert" | "delete";

export interface Edit<T> {
  kind: EditKind;
  value: T;
  /** 0-based index in the original sequence; undefined for inserts. */
  oldIndex?: number;
  /** 0-based index in the new sequence; undefined for deletes. */
  newIndex?: number;
}

/**
 * Myers' O(ND) diff.
 *
 * Walks the edit graph one D (edit distance) at a time, recording the furthest
 * reaching path per diagonal, then backtracks through the saved traces to
 * recover the actual edit script. Chosen over a naive LCS table because the
 * table is O(N*M) in *memory* — a 3000-line file against its edited self is
 * nine million cells, versus Myers touching work proportional to the number of
 * changes, which for a generated patch is small.
 */
export function myersDiff<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean = Object.is): Array<Edit<T>> {
  const n = a.length;
  const m = b.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((value, i) => ({ kind: "insert" as const, value, newIndex: i }));
  if (m === 0) return a.map((value, i) => ({ kind: "delete" as const, value, oldIndex: i }));

  const max = n + m;
  const offset = max;
  // v[k + offset] = furthest x reached on diagonal k.
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  let found = -1;

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      // Pick the move that gets us furthest: down (insert) or right (delete).
      let x: number;
      if (k === -d || (k !== d && (v[k - 1 + offset] as number) < (v[k + 1 + offset] as number))) {
        x = v[k + 1 + offset] as number;
      } else {
        x = (v[k - 1 + offset] as number) + 1;
      }
      let y = x - k;

      // Slide down the diagonal for free while the elements match.
      while (x < n && y < m && equals(a[x] as T, b[y] as T)) {
        x++;
        y++;
      }

      v[k + offset] = x;

      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }

    if (found !== -1) break;
  }

  if (found === -1) {
    // Unreachable for well-formed input, but returning a whole-file replace is
    // a defensible fallback rather than throwing at render time.
    return [
      ...a.map((value, i) => ({ kind: "delete" as const, value, oldIndex: i })),
      ...b.map((value, i) => ({ kind: "insert" as const, value, newIndex: i })),
    ];
  }

  // Backtrack through the traces to build the script.
  const edits: Array<Edit<T>> = [];
  let x = n;
  let y = m;

  for (let d = found; d > 0; d--) {
    const prev = trace[d] as Int32Array;
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && (prev[k - 1 + offset] as number) < (prev[k + 1 + offset] as number))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = prev[prevK + offset] as number;
    const prevY = prevX - prevK;

    // Everything above the branch point on this diagonal is unchanged.
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ kind: "equal", value: a[x] as T, oldIndex: x, newIndex: y });
    }

    if (d > 0) {
      if (x === prevX) {
        y--;
        edits.push({ kind: "insert", value: b[y] as T, newIndex: y });
      } else {
        x--;
        edits.push({ kind: "delete", value: a[x] as T, oldIndex: x });
      }
    }
  }

  // Any remaining prefix matched.
  while (x > 0 && y > 0) {
    x--;
    y--;
    edits.push({ kind: "equal", value: a[x] as T, oldIndex: x, newIndex: y });
  }

  return edits.reverse();
}

/* ------------------------------------------------------------------ *
 * Word-level diff
 * ------------------------------------------------------------------ */

/**
 * Splits into words plus their trailing whitespace/punctuation, so a rename
 * highlights the identifier rather than the whole line. Keeping delimiters as
 * their own tokens means the reassembled line is byte-identical to the input.
 */
function splitWords(line: string): string[] {
  return line.match(/[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g) ?? [];
}

export interface WordSpan {
  text: string;
  changed: boolean;
}

/** Word-level diff of one changed line, for highlighting only what moved. */
export function diffWords(before: string, after: string): { before: WordSpan[]; after: WordSpan[] } {
  const edits = myersDiff(splitWords(before), splitWords(after));

  const beforeSpans: WordSpan[] = [];
  const afterSpans: WordSpan[] = [];

  for (const edit of edits) {
    if (edit.kind === "equal") {
      beforeSpans.push({ text: edit.value, changed: false });
      afterSpans.push({ text: edit.value, changed: false });
    } else if (edit.kind === "delete") {
      beforeSpans.push({ text: edit.value, changed: true });
    } else {
      afterSpans.push({ text: edit.value, changed: true });
    }
  }

  return { before: mergeSpans(beforeSpans), after: mergeSpans(afterSpans) };
}

/** Collapses adjacent spans of the same kind so the DOM stays small. */
function mergeSpans(spans: WordSpan[]): WordSpan[] {
  const out: WordSpan[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && last.changed === span.changed) last.text += span.text;
    else out.push({ ...span });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Hunks
 * ------------------------------------------------------------------ */

export interface DiffLine {
  kind: EditKind;
  /** 1-based line number in the original file. */
  oldNumber?: number;
  /** 1-based line number in the new file. */
  newNumber?: number;
  text: string;
  /** Set on a delete/insert pair recognised as one edited line. */
  wordSpans?: WordSpan[];
}

export interface DiffHunk {
  /** 1-based start line in the original file. */
  oldStart: number;
  /** 1-based start line in the new file. */
  newStart: number;
  lines: DiffLine[];
}

export interface ComputeDiffOptions {
  /** Unchanged lines kept either side of a change. */
  context?: number;
}

/**
 * Diffs two file contents into hunks with per-line numbering and intra-line
 * word spans.
 *
 * A delete immediately followed by an insert is treated as one *modified*
 * line and given word-level spans — which is what makes a renamed variable
 * light up as one word instead of the entire line reading as replaced.
 */
export function computeDiff(before: string, after: string, options: ComputeDiffOptions = {}): DiffHunk[] {
  const { context = 3 } = options;

  const beforeLines = before.length === 0 ? [] : before.replace(/\n$/, "").split("\n");
  const afterLines = after.length === 0 ? [] : after.replace(/\n$/, "").split("\n");

  const edits = myersDiff(beforeLines, afterLines, (x, y) => x === y);

  // Pair adjacent delete/insert runs so each becomes a word-diffed line.
  const lines: DiffLine[] = [];
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i] as Edit<string>;

    if (edit.kind === "equal") {
      lines.push({
        kind: "equal",
        text: edit.value,
        oldNumber: (edit.oldIndex ?? 0) + 1,
        newNumber: (edit.newIndex ?? 0) + 1,
      });
      continue;
    }

    if (edit.kind === "delete") {
      const deletes: Array<Edit<string>> = [];
      let j = i;
      while (j < edits.length && (edits[j] as Edit<string>).kind === "delete") {
        deletes.push(edits[j] as Edit<string>);
        j++;
      }
      const inserts: Array<Edit<string>> = [];
      while (j < edits.length && (edits[j] as Edit<string>).kind === "insert") {
        inserts.push(edits[j] as Edit<string>);
        j++;
      }

      const pairs = Math.min(deletes.length, inserts.length);
      for (let p = 0; p < deletes.length; p++) {
        const del = deletes[p] as Edit<string>;
        const ins = p < pairs ? (inserts[p] as Edit<string>) : undefined;
        lines.push({
          kind: "delete",
          text: del.value,
          oldNumber: (del.oldIndex ?? 0) + 1,
          wordSpans: ins ? diffWords(del.value, ins.value).before : undefined,
        });
      }
      for (let p = 0; p < inserts.length; p++) {
        const ins = inserts[p] as Edit<string>;
        const del = p < pairs ? (deletes[p] as Edit<string>) : undefined;
        lines.push({
          kind: "insert",
          text: ins.value,
          newNumber: (ins.newIndex ?? 0) + 1,
          wordSpans: del ? diffWords(del.value, ins.value).after : undefined,
        });
      }

      i = j - 1;
      continue;
    }

    // A lone insert with no preceding delete.
    lines.push({ kind: "insert", text: edit.value, newNumber: (edit.newIndex ?? 0) + 1 });
  }

  return groupIntoHunks(lines, context);
}

/** Keeps `context` unchanged lines around each change and drops the rest. */
function groupIntoHunks(lines: DiffLine[], context: number): DiffHunk[] {
  const changedAt = lines.map((line) => line.kind !== "equal");
  if (!changedAt.some(Boolean)) return [];

  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!changedAt[i]) continue;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
      keep[j] = true;
    }
  }

  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0] as DiffLine;
    hunks.push({
      oldStart: first.oldNumber ?? 1,
      newStart: first.newNumber ?? 1,
      lines: current,
    });
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) current.push(lines[i] as DiffLine);
    else flush();
  }
  flush();

  return hunks;
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const rootClass = css({
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  lineHeight: 1.65,
  color: theme.color.foreground,
  border: `1px solid ${theme.color.border}`,
  borderRadius: theme.radius.md,
  overflow: "hidden",
  backgroundColor: theme.color.card,
});

const headerClass = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: theme.space[2],
  padding: `${theme.space[2]} ${theme.space[3]}`,
  borderBottom: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.muted,
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
});

const statClass = css({ display: "inline-flex", gap: theme.space[2], fontVariantNumeric: "tabular-nums" });
const addStatClass = css({ color: theme.color.success });
const delStatClass = css({ color: theme.color.destructive });

const hunkHeaderClass = css({
  padding: `2px ${theme.space[3]}`,
  backgroundColor: theme.color.muted,
  color: theme.color.mutedForeground,
  borderTop: `1px solid ${theme.color.border}`,
  borderBottom: `1px solid ${theme.color.border}`,
  fontSize: "0.6875rem",
});

const scrollClass = css({ overflowX: "auto" });

const lineClass = css({ display: "flex", whiteSpace: "pre", minWidth: "max-content" });

const gutterClass = css({
  flexShrink: 0,
  userSelect: "none",
  textAlign: "right",
  padding: `0 ${theme.space[2]}`,
  color: theme.color.mutedForeground,
  fontVariantNumeric: "tabular-nums",
  opacity: 0.7,
});

const signClass = css({
  flexShrink: 0,
  width: "1.25ch",
  userSelect: "none",
  textAlign: "center",
  opacity: 0.8,
});

const contentClass = css({ paddingRight: theme.space[3], flex: 1 });

// Backgrounds are deliberately low-contrast: the *word* highlight is what
// should draw the eye on a modified line, and a saturated full-line wash
// would swamp it.
const insertLineClass = css({ backgroundColor: "color-mix(in srgb, currentColor 0%, rgb(34 160 90 / 0.10))" });
const deleteLineClass = css({ backgroundColor: "color-mix(in srgb, currentColor 0%, rgb(220 60 55 / 0.10))" });

const insertWordClass = css({
  backgroundColor: "rgb(34 160 90 / 0.28)",
  borderRadius: "2px",
});

const deleteWordClass = css({
  backgroundColor: "rgb(220 60 55 / 0.28)",
  borderRadius: "2px",
});

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/**
 * Highlights one line, then splits the highlighted tokens at word-span
 * boundaries.
 *
 * Syntax tokens and word-diff spans are two independent segmentations of the
 * same string, so neither can simply nest inside the other — this walks both
 * in one pass and emits the intersection, which is what lets a changed word
 * keep its syntax colour instead of flattening to plain text.
 */
function renderLine(text: string, language: SyntaxLanguage, spans: WordSpan[] | undefined, changedClass: string): ReactNode {
  const { tokens } = tokenizeLine(text, language, "none" as ScanState);

  if (!spans || spans.length === 0) return <TokenLine tokens={tokens} />;

  // Map each character index to whether it sits inside a changed span.
  const changedAt = new Array<boolean>(text.length).fill(false);
  let at = 0;
  for (const span of spans) {
    for (let i = 0; i < span.text.length && at < text.length; i++, at++) changedAt[at] = span.changed;
  }

  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const token of tokens) {
    let start = 0;
    while (start < token.value.length) {
      const isChanged = changedAt[cursor + start] ?? false;
      let end = start + 1;
      while (end < token.value.length && (changedAt[cursor + end] ?? false) === isChanged) end++;

      const piece: Token = { type: token.type, value: token.value.slice(start, end) };
      out.push(
        isChanged ? (
          <span key={key++} className={changedClass}>
            <TokenLine tokens={[piece]} />
          </span>
        ) : (
          <TokenLine key={key++} tokens={[piece]} />
        ),
      );
      start = end;
    }
    cursor += token.value.length;
  }

  return <>{out}</>;
}

export interface DiffViewProps {
  before: string;
  after: string;
  /** Drives both the header label and the syntax grammar. */
  filename?: string;
  language?: SyntaxLanguage;
  /** Unchanged lines kept either side of a change. */
  context?: number;
  showLineNumbers?: boolean;
  /** Replaces the built-in header (or hides it when null). */
  header?: ReactNode;
  className?: string;
}

/**
 * A unified diff with syntax highlighting and word-level intra-line
 * highlighting: on a modified line only the words that actually changed are
 * tinted, not the whole line.
 */
export function DiffView({
  before,
  after,
  filename,
  language,
  context = 3,
  showLineNumbers = true,
  header,
  className,
}: DiffViewProps) {
  const resolved = language ?? (filename ? languageFromFilename(filename) : "ts");
  const hunks = useMemo(() => computeDiff(before, after, { context }), [before, after, context]);

  const { additions, deletions } = useMemo(() => {
    let a = 0;
    let d = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.kind === "insert") a++;
        else if (line.kind === "delete") d++;
      }
    }
    return { additions: a, deletions: d };
  }, [hunks]);

  const gutterWidth = `${String(
    Math.max(
      ...hunks.flatMap((h) => h.lines.map((l) => Math.max(l.oldNumber ?? 0, l.newNumber ?? 0))),
      1,
    ),
  ).length}ch`;

  return (
    <div className={className ? `${rootClass} ${className}` : rootClass}>
      {header === null ? null : header !== undefined ? (
        header
      ) : (
        <div className={headerClass}>
          <span>{filename ?? "Diff"}</span>
          <span className={statClass}>
            <span className={addStatClass}>+{additions}</span>
            <span className={delStatClass}>−{deletions}</span>
          </span>
        </div>
      )}

      {hunks.length === 0 ? (
        <div style={{ padding: theme.space[4], color: theme.color.mutedForeground, fontFamily: theme.fontFamily.sans }}>
          No changes
        </div>
      ) : (
        hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex}>
            <div className={hunkHeaderClass}>
              @@ -{hunk.oldStart} +{hunk.newStart} @@
            </div>
            <div className={scrollClass}>
              {hunk.lines.map((line, lineIndex) => {
                const lineStyle =
                  line.kind === "insert" ? insertLineClass : line.kind === "delete" ? deleteLineClass : "";
                const wordStyle = line.kind === "insert" ? insertWordClass : deleteWordClass;

                return (
                  <div key={lineIndex} className={lineStyle ? `${lineClass} ${lineStyle}` : lineClass}>
                    {showLineNumbers ? (
                      <>
                        <span className={gutterClass} style={{ width: gutterWidth }}>
                          {line.oldNumber ?? ""}
                        </span>
                        <span className={gutterClass} style={{ width: gutterWidth }}>
                          {line.newNumber ?? ""}
                        </span>
                      </>
                    ) : null}
                    <span className={signClass} aria-hidden="true">
                      {line.kind === "insert" ? "+" : line.kind === "delete" ? "−" : " "}
                    </span>
                    <span className={contentClass}>
                      {renderLine(line.text, resolved, line.wordSpans, wordStyle)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
