"use client";

import { css, themeVars as theme } from "@yugnex/core";
import { useMemo, type ReactNode } from "react";
import { FileIcon, type FileStatus } from "./file-icon";
import { languageFromFilename, Syntax, type SyntaxLanguage } from "./syntax";

/* ------------------------------------------------------------------ *
 * Block model
 * ------------------------------------------------------------------ */

export type AlertKind = "note" | "tip" | "important" | "warning" | "caution";

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang?: string; code: string; /** Still being streamed — no closing fence yet. */ open: boolean }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][]; align: Array<"left" | "center" | "right"> }
  | { type: "alert"; kind: AlertKind; lines: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "rule" }
  | { type: "mermaid"; code: string; open: boolean };

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

/**
 * Parses markdown into blocks.
 *
 * Written to tolerate a *truncated* document, because that is the normal case
 * here: the plan is rendered while it streams, so the last block is routinely
 * an unterminated fence, a half-written table, or a heading with no body yet.
 * Anything still open is emitted with `open: true` rather than discarded, so
 * content appears as it arrives instead of snapping in at the closing fence.
 */
export function parsePlan(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const flushParagraph = (buffer: string[]) => {
    if (buffer.length === 0) return;
    blocks.push({ type: "paragraph", text: buffer.join("\n") });
    buffer.length = 0;
  };

  const paragraph: string[] = [];

  while (i < lines.length) {
    const line = lines[i] as string;

    // Fenced code (and mermaid).
    const fence = /^\s*```+\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fence) {
      flushParagraph(paragraph);
      const lang = (fence[1] ?? "").toLowerCase();
      const body: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (/^\s*```+\s*$/.test(lines[i] as string)) {
          closed = true;
          i++;
          break;
        }
        body.push(lines[i] as string);
        i++;
      }
      const code = body.join("\n");
      if (lang === "mermaid") blocks.push({ type: "mermaid", code, open: !closed });
      else blocks.push({ type: "code", lang: lang || undefined, code, open: !closed });
      continue;
    }

    // Heading.
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(paragraph);
      blocks.push({
        type: "heading",
        level: (heading[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6,
        text: (heading[2] as string).trim(),
      });
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) {
      flushParagraph(paragraph);
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    // Blockquote — GFM alerts are a blockquote whose first line is [!KIND].
    if (/^\s{0,3}>/.test(line)) {
      flushParagraph(paragraph);
      const quoted: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i] as string)) {
        quoted.push((lines[i] as string).replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      const alert = quoted.length > 0 ? ALERT_RE.exec(quoted[0] as string) : null;
      if (alert) {
        blocks.push({
          type: "alert",
          kind: (alert[1] as string).toLowerCase() as AlertKind,
          lines: quoted.slice(1),
        });
      } else {
        blocks.push({ type: "quote", lines: quoted });
      }
      continue;
    }

    // Table — a header row followed by a delimiter row.
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] as string)) {
      flushParagraph(paragraph);
      const header = splitRow(line);
      const align = splitRow(lines[i + 1] as string).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        if (left && right) return "center" as const;
        if (right) return "right" as const;
        return "left" as const;
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] as string).includes("|") && (lines[i] as string).trim() !== "") {
        rows.push(splitRow(lines[i] as string));
        i++;
      }
      blocks.push({ type: "table", header, rows, align });
      continue;
    }

    // List.
    const bullet = /^\s{0,3}(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph(paragraph);
      const ordered = /^\s{0,3}\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const match = /^\s{0,3}(?:[-*+]|\d+\.)\s+(.*)$/.exec(lines[i] as string);
        if (!match) break;
        items.push((match[1] as string).trim());
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph(paragraph);
      i++;
      continue;
    }

    paragraph.push(line);
    i++;
  }

  flushParagraph(paragraph);
  return blocks;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/* ------------------------------------------------------------------ *
 * Inline rendering
 * ------------------------------------------------------------------ */

const FILE_CHIP_RE = /\[(NEW|MODIFY|DELETE)\]\s*`?([^`\]\s]+)`?/g;

const CHIP_STATUS: Record<string, FileStatus> = {
  NEW: "new",
  MODIFY: "modified",
  DELETE: "deleted",
};

const chipClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[1],
  padding: `1px ${theme.space[1.5]} 1px ${theme.space[1]}`,
  margin: "0 1px",
  borderRadius: theme.radius.sm,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.muted,
  fontFamily: theme.fontFamily.mono,
  fontSize: "0.8125em",
  verticalAlign: "baseline",
  whiteSpace: "nowrap",
});

const chipKindClass = css({
  fontFamily: theme.fontFamily.sans,
  fontSize: "0.75em",
  fontWeight: theme.fontWeight.semibold,
  letterSpacing: "0.02em",
  textTransform: "uppercase",
});

const CHIP_COLOR: Record<FileStatus, string> = {
  new: theme.color.success,
  modified: theme.color.warning,
  deleted: theme.color.destructive,
  unchanged: theme.color.mutedForeground,
};

const codeInlineClass = css({
  padding: `1px ${theme.space[1]}`,
  borderRadius: theme.radius.sm,
  backgroundColor: theme.color.muted,
  fontFamily: theme.fontFamily.mono,
  fontSize: "0.875em",
});

const linkClass = css({
  color: theme.color.primary,
  textDecoration: "underline",
  textUnderlineOffset: "2px",
});

/**
 * Renders inline markdown plus the `[NEW]`/`[MODIFY]`/`[DELETE] path` chips.
 *
 * File chips are matched first and the remaining text is then scanned for
 * inline markup, so a path containing `_` or `*` can't be mangled into
 * emphasis on its way through.
 */
function renderInline(text: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  FILE_CHIP_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FILE_CHIP_RE.exec(text)) !== null) {
    if (match.index > cursor) out.push(...renderMarkup(text.slice(cursor, match.index), `${keyPrefix}m${key++}`));

    const status = CHIP_STATUS[(match[1] as string).toUpperCase()] ?? "unchanged";
    const path = match[2] as string;
    out.push(
      <span key={`${keyPrefix}c${key++}`} className={chipClass}>
        <FileIcon filename={path} size={12} />
        <span className={chipKindClass} style={{ color: CHIP_COLOR[status] }}>
          {match[1]}
        </span>
        {path}
      </span>,
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) out.push(...renderMarkup(text.slice(cursor), `${keyPrefix}m${key++}`));
  return out;
}

function renderMarkup(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[[^\]]*\]\([^)]*\))/g;
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index));

    if (match[1]) {
      out.push(
        <code key={`${keyPrefix}-${key++}`} className={codeInlineClass}>
          {match[1].slice(1, -1)}
        </code>,
      );
    } else if (match[2] || match[3]) {
      const body = (match[2] ?? match[3]) as string;
      out.push(<strong key={`${keyPrefix}-${key++}`}>{body.slice(2, -2)}</strong>);
    } else if (match[4]) {
      out.push(<em key={`${keyPrefix}-${key++}`}>{match[4].slice(1, -1)}</em>);
    } else if (match[5]) {
      const link = /\[([^\]]*)\]\(([^)]*)\)/.exec(match[5]);
      out.push(
        <a key={`${keyPrefix}-${key++}`} className={linkClass} href={link?.[2] ?? "#"}>
          {link?.[1] ?? ""}
        </a>,
      );
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

/* ------------------------------------------------------------------ *
 * Block styles
 * ------------------------------------------------------------------ */

const rootClass = css({
  fontFamily: theme.fontFamily.sans,
  fontSize: theme.fontSize.sm,
  lineHeight: theme.lineHeight.base,
  color: theme.color.foreground,
});

const headingClass = css({
  fontWeight: theme.fontWeight.semibold,
  letterSpacing: theme.letterSpacing.tight,
  margin: `${theme.space[5]} 0 ${theme.space[2]}`,
  "&:first-child": { marginTop: 0 },
});

const HEADING_SIZE: Record<number, string> = {
  1: theme.fontSize["2xl"],
  2: theme.fontSize.xl,
  3: theme.fontSize.lg,
  4: theme.fontSize.base,
  5: theme.fontSize.sm,
  6: theme.fontSize.xs,
};

const paragraphClass = css({ margin: `0 0 ${theme.space[3]}` });

const listClass = css({
  margin: `0 0 ${theme.space[3]}`,
  paddingLeft: theme.space[5],
  display: "flex",
  flexDirection: "column",
  gap: theme.space[1],
});

const tableWrapClass = css({ overflowX: "auto", marginBottom: theme.space[4] });

const tableClass = css({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: theme.fontSize.sm,
});

const thClass = css({
  textAlign: "left",
  padding: `${theme.space[2]} ${theme.space[3]}`,
  borderBottom: `1px solid ${theme.color.border}`,
  fontWeight: theme.fontWeight.semibold,
  color: theme.color.mutedForeground,
  fontSize: theme.fontSize.xs,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  whiteSpace: "nowrap",
});

const tdClass = css({
  padding: `${theme.space[2]} ${theme.space[3]}`,
  borderBottom: `1px solid ${theme.color.border}`,
  verticalAlign: "top",
});

const quoteClass = css({
  margin: `0 0 ${theme.space[3]}`,
  padding: `${theme.space[1]} 0 ${theme.space[1]} ${theme.space[3]}`,
  borderLeft: `3px solid ${theme.color.border}`,
  color: theme.color.mutedForeground,
});

const ruleClass = css({
  border: "none",
  height: "1px",
  backgroundColor: theme.color.border,
  margin: `${theme.space[5]} 0`,
});

const alertClass = css({
  display: "flex",
  gap: theme.space[2.5],
  margin: `0 0 ${theme.space[4]}`,
  padding: theme.space[3],
  borderRadius: theme.radius.md,
  border: "1px solid",
  backgroundColor: theme.color.muted,
});

const alertTitleClass = css({
  fontWeight: theme.fontWeight.semibold,
  fontSize: theme.fontSize.xs,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  marginBottom: theme.space[1],
});

const codeWrapClass = css({
  marginBottom: theme.space[4],
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.muted,
  overflow: "hidden",
});

const codeHeaderClass = css({
  padding: `${theme.space[1]} ${theme.space[3]}`,
  borderBottom: `1px solid ${theme.color.border}`,
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  fontFamily: theme.fontFamily.mono,
});

const codeBodyClass = css({ padding: theme.space[3] });

const mermaidClass = css({
  marginBottom: theme.space[4],
  padding: theme.space[3],
  borderRadius: theme.radius.md,
  border: `1px dashed ${theme.color.border}`,
  backgroundColor: theme.color.muted,
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  color: theme.color.mutedForeground,
  whiteSpace: "pre-wrap",
  overflowX: "auto",
});

const ALERT_COLOR: Record<AlertKind, string> = {
  note: theme.color.primary,
  tip: theme.color.success,
  important: theme.color.primary,
  warning: theme.color.warning,
  caution: theme.color.destructive,
};

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface PlanDocumentProps {
  /** Markdown source. Safe to pass a partial document mid-stream. */
  source: string;
  /**
   * Renders a mermaid block. Left to the caller: bundling a diagram engine
   * would dwarf this component and pull in the dependency the library exists
   * without. Without it, the source is shown verbatim in a labeled block.
   */
  renderMermaid?: (code: string) => ReactNode;
  /** Wraps each top-level section (a heading and the blocks under it). */
  renderSection?: (section: { heading?: string; index: number; children: ReactNode }) => ReactNode;
  className?: string;
}

/**
 * A streaming markdown renderer for agent plans: headings, tables, fenced
 * code (syntax-highlighted), GFM alerts, mermaid, and inline
 * `[NEW]`/`[MODIFY]`/`[DELETE] path` file chips.
 */
export function PlanDocument({ source, renderMermaid, renderSection, className }: PlanDocumentProps) {
  const blocks = useMemo(() => parsePlan(source), [source]);

  const rendered = blocks.map((block, index) => renderBlock(block, index, renderMermaid));

  if (!renderSection) {
    return <div className={className ? `${rootClass} ${className}` : rootClass}>{rendered}</div>;
  }

  // Group into sections at h1/h2 boundaries so a caller can wrap each one —
  // which is what lets review-gate operate at "section" granularity.
  const sections: Array<{ heading?: string; children: ReactNode[] }> = [];
  blocks.forEach((block, index) => {
    const isBoundary = block.type === "heading" && block.level <= 2;
    if (isBoundary || sections.length === 0) {
      sections.push({ heading: block.type === "heading" ? block.text : undefined, children: [] });
    }
    (sections[sections.length - 1] as { children: ReactNode[] }).children.push(rendered[index]);
  });

  return (
    <div className={className ? `${rootClass} ${className}` : rootClass}>
      {sections.map((section, index) => (
        <div key={index}>{renderSection({ heading: section.heading, index, children: section.children })}</div>
      ))}
    </div>
  );
}

function renderBlock(block: Block, index: number, renderMermaid?: (code: string) => ReactNode): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as "h1";
      return (
        <Tag key={index} className={headingClass} style={{ fontSize: HEADING_SIZE[block.level] }}>
          {renderInline(block.text, `h${index}`)}
        </Tag>
      );
    }

    case "paragraph":
      return (
        <p key={index} className={paragraphClass}>
          {renderInline(block.text, `p${index}`)}
        </p>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={index} className={listClass}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, `l${index}-${i}`)}</li>
          ))}
        </Tag>
      );
    }

    case "table":
      return (
        <div key={index} className={tableWrapClass}>
          <table className={tableClass}>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i} className={thClass} style={{ textAlign: block.align[i] ?? "left" }}>
                    {renderInline(cell, `th${index}-${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className={tdClass} style={{ textAlign: block.align[c] ?? "left" }}>
                      {renderInline(cell, `td${index}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "alert":
      return (
        <div
          key={index}
          className={alertClass}
          style={{ borderColor: ALERT_COLOR[block.kind] }}
          role={block.kind === "caution" || block.kind === "warning" ? "alert" : undefined}
        >
          <div>
            <div className={alertTitleClass} style={{ color: ALERT_COLOR[block.kind] }}>
              {block.kind}
            </div>
            {block.lines.map((line, i) => (
              <p key={i} className={paragraphClass} style={{ marginBottom: 0 }}>
                {renderInline(line, `a${index}-${i}`)}
              </p>
            ))}
          </div>
        </div>
      );

    case "quote":
      return (
        <blockquote key={index} className={quoteClass}>
          {block.lines.map((line, i) => (
            <p key={i} className={paragraphClass} style={{ marginBottom: 0 }}>
              {renderInline(line, `q${index}-${i}`)}
            </p>
          ))}
        </blockquote>
      );

    case "rule":
      return <hr key={index} className={ruleClass} />;

    case "mermaid":
      return (
        <div key={index}>
          {renderMermaid ? (
            renderMermaid(block.code)
          ) : (
            <div className={mermaidClass} aria-label="Mermaid diagram source">
              {block.code}
            </div>
          )}
        </div>
      );

    case "code": {
      const lang = normalizeLang(block.lang);
      return (
        <div key={index} className={codeWrapClass}>
          {block.lang ? <div className={codeHeaderClass}>{block.lang}</div> : null}
          <div className={codeBodyClass}>
            <Syntax code={block.code} language={lang} />
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

/** Maps a fence info-string to a supported grammar, falling back sensibly. */
function normalizeLang(lang: string | undefined): SyntaxLanguage {
  if (!lang) return "ts";
  const l = lang.toLowerCase();
  const direct: Record<string, SyntaxLanguage> = {
    ts: "ts",
    typescript: "ts",
    js: "ts",
    javascript: "ts",
    tsx: "tsx",
    jsx: "tsx",
    json: "json",
    css: "css",
    scss: "css",
    sql: "sql",
    md: "md",
    markdown: "md",
    yaml: "yaml",
    yml: "yaml",
    dockerfile: "dockerfile",
    docker: "dockerfile",
    env: "env",
    dotenv: "env",
    sh: "sh",
    bash: "sh",
    shell: "sh",
    zsh: "sh",
    console: "sh",
  };
  // An unrecognised info-string is often a filename ("app/page.tsx"), which
  // the syntax component already knows how to map.
  return direct[l] ?? languageFromFilename(l);
}
