"use client";

import { css, keyframes, themeVars as theme } from "@yugnex/core";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------ *
 * ANSI parsing
 * ------------------------------------------------------------------ */

export interface AnsiStyle {
  color?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** SGR 7 — swap foreground and background at render time. */
  inverse?: boolean;
  /** SGR 8 — rendered as a placeholder rather than actually hidden. */
  hidden?: boolean;
  strike?: boolean;
}

export interface AnsiSpan {
  text: string;
  style: AnsiStyle;
}

/**
 * The 16 base colours as CSS variables, so a consumer can retheme the palette
 * without patching the parser. Values are set in `ANSI_CSS` below.
 */
const BASE_COLORS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright-black",
  "bright-red",
  "bright-green",
  "bright-yellow",
  "bright-blue",
  "bright-magenta",
  "bright-cyan",
  "bright-white",
] as const;

function baseColor(index: number): string {
  return `var(--nx-ansi-${BASE_COLORS[index] ?? "white"})`;
}

/**
 * Resolves an xterm-256 index to a colour.
 *
 * 0-15 map to the themeable base palette; 16-231 are a 6x6x6 RGB cube;
 * 232-255 are a 24-step greyscale ramp. Computing the cube and ramp rather
 * than shipping a 256-entry table keeps this to a few lines and makes the
 * derivation auditable.
 */
function xterm256(index: number): string {
  if (index < 16) return baseColor(index);

  if (index < 232) {
    const n = index - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(n / 36) % 6] as number;
    const g = steps[Math.floor(n / 6) % 6] as number;
    const b = steps[n % 6] as number;
    return `rgb(${r} ${g} ${b})`;
  }

  const level = 8 + (index - 232) * 10;
  return `rgb(${level} ${level} ${level})`;
}

/** Applies one SGR parameter run to a style, returning the next style. */
function applySgr(params: number[], style: AnsiStyle): AnsiStyle {
  const next: AnsiStyle = { ...style };

  for (let i = 0; i < params.length; i++) {
    const code = params[i] as number;

    if (code === 0) {
      // Reset clears everything, so return a fresh object rather than
      // deleting keys one at a time.
      for (const key of Object.keys(next) as Array<keyof AnsiStyle>) delete next[key];
      continue;
    }

    if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 8) next.hidden = true;
    else if (code === 9) next.strike = true;
    else if (code === 21 || code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 27) delete next.inverse;
    else if (code === 28) delete next.hidden;
    else if (code === 29) delete next.strike;
    else if (code >= 30 && code <= 37) next.color = baseColor(code - 30);
    else if (code === 39) delete next.color;
    else if (code >= 40 && code <= 47) next.background = baseColor(code - 40);
    else if (code === 49) delete next.background;
    else if (code >= 90 && code <= 97) next.color = baseColor(code - 90 + 8);
    else if (code >= 100 && code <= 107) next.background = baseColor(code - 100 + 8);
    else if (code === 38 || code === 48) {
      // Extended colour: 5;n for 256-colour, 2;r;g;b for truecolor.
      const mode = params[i + 1];
      if (mode === 5 && params[i + 2] !== undefined) {
        const value = xterm256(params[i + 2] as number);
        if (code === 38) next.color = value;
        else next.background = value;
        i += 2;
      } else if (mode === 2 && params[i + 4] !== undefined) {
        const value = `rgb(${params[i + 2]} ${params[i + 3]} ${params[i + 4]})`;
        if (code === 38) next.color = value;
        else next.background = value;
        i += 4;
      }
      // Malformed extended sequence (38/48 not followed by a 2 or 5 mode, or
      // truncated mid-stream): consume only the introducer and let the loop
      // advance normally. Skipping ahead would swallow the *next* parameter,
      // so `ESC[38;1m` would silently lose its bold.
    }
  }

  return next;
}

// ESC and BEL as explicit escapes rather than literal control bytes. These
// files are distributed by copy-paste, and a raw 0x1B in source is exactly the
// kind of thing an editor or a clipboard round-trip drops silently — leaving a
// parser that looks right and matches nothing.
const ESC = "\u001b";
const BEL = "\u0007";

// CSI sequences (ESC [ ... final-byte). SGR (`m`) is interpreted; every other
// final byte is recognised only so it can be dropped rather than printed as
// mojibake.
const CSI_RE = new RegExp(`${ESC}\\[([0-9;:?]*)([A-Za-z])`, "g");

// OSC sequences (ESC ] ... BEL | ESC \\) — window titles, hyperlinks. Bounded
// so an unterminated OSC cannot swallow the rest of the output.
const OSC_RE = new RegExp(`${ESC}\\][^${ESC}${BEL}]*(?:${BEL}|${ESC}\\\\)`, "g");

/**
 * Parses a chunk of terminal output into styled spans.
 *
 * Handles SGR colour/attribute codes, xterm-256 and truecolor, and strips the
 * non-SGR escape sequences that real tool output is full of (cursor moves,
 * line erases, OSC titles) instead of rendering them as garbage. Carriage
 * returns are applied as line rewrites, which is what makes progress bars and
 * spinners collapse to their final state rather than stacking up.
 */
export function parseAnsi(input: string, initial: AnsiStyle = {}): { spans: AnsiSpan[]; style: AnsiStyle } {
  const withoutOsc = input.replace(OSC_RE, "");

  const spans: AnsiSpan[] = [];
  let style = initial;
  let cursor = 0;

  CSI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  const push = (text: string) => {
    if (text.length === 0) return;
    const last = spans[spans.length - 1];
    if (last && sameStyle(last.style, style)) last.text += text;
    else spans.push({ text, style: { ...style } });
  };

  while ((match = CSI_RE.exec(withoutOsc)) !== null) {
    if (match.index > cursor) push(withoutOsc.slice(cursor, match.index));

    if (match[2] === "m") {
      const raw = match[1] ?? "";
      const params = raw === "" ? [0] : raw.split(";").map((part) => Number.parseInt(part, 10) || 0);
      style = applySgr(params, style);
    }
    // Every other final byte (cursor movement, erase, scroll) is consumed and
    // discarded — this is a log surface, not a screen emulator.

    cursor = match.index + match[0].length;
  }

  if (cursor < withoutOsc.length) push(withoutOsc.slice(cursor));

  return { spans, style };
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
  return (
    a.color === b.color &&
    a.background === b.background &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    a.hidden === b.hidden &&
    a.strike === b.strike
  );
}

/**
 * Splits output into lines, applying carriage-return rewrites.
 *
 * A `\r` without a following `\n` means "go back to column 0 and overwrite",
 * which is how spinners and progress bars work. Applying it means a hundred
 * progress frames collapse into the one line the user would actually have
 * seen, instead of a hundred stacked lines.
 */
export function splitTerminalLines(text: string): string[] {
  const out: string[] = [];

  for (const rawLine of text.split("\n")) {
    if (!rawLine.includes("\r")) {
      out.push(rawLine);
      continue;
    }
    // Later segments overwrite earlier ones from column 0; a shorter
    // overwrite leaves the tail of the longer one visible, as a real
    // terminal would.
    let line = "";
    for (const segment of rawLine.split("\r")) {
      line = segment + line.slice(segment.length);
    }
    out.push(line);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

export type RunStatus = "running" | "success" | "failed" | "cancelled";

export interface TerminalRun {
  id: string;
  /** The command as typed, e.g. "pnpm test --run". */
  command: string;
  /** Raw output, ANSI escapes included. Safe to grow while streaming. */
  output: string;
  status: RunStatus;
  exitCode?: number;
  /** Milliseconds; shown in the header when present. */
  durationMs?: number;
  /** Working directory shown before the prompt. */
  cwd?: string;
}

/* ------------------------------------------------------------------ *
 * Styles
 * ------------------------------------------------------------------ */

const ANSI_CSS = `
:root{
--nx-ansi-black:#3b3b45;--nx-ansi-red:#c8332c;--nx-ansi-green:#2c8a52;
--nx-ansi-yellow:#a8760a;--nx-ansi-blue:#2f5fd0;--nx-ansi-magenta:#9b3fb5;
--nx-ansi-cyan:#1a7f8e;--nx-ansi-white:#c8c8d0;
--nx-ansi-bright-black:#6b6b78;--nx-ansi-bright-red:#e0554d;--nx-ansi-bright-green:#3aa866;
--nx-ansi-bright-yellow:#c9900f;--nx-ansi-bright-blue:#4a7ae8;--nx-ansi-bright-magenta:#b558cd;
--nx-ansi-bright-cyan:#2199aa;--nx-ansi-bright-white:#f0f0f4;
}
[data-theme="dark"]{
--nx-ansi-black:#2a2a33;--nx-ansi-red:#f0736b;--nx-ansi-green:#5fd18a;
--nx-ansi-yellow:#e0b341;--nx-ansi-blue:#7aa2f7;--nx-ansi-magenta:#d18ae8;
--nx-ansi-cyan:#56c8d8;--nx-ansi-white:#d8d8e0;
--nx-ansi-bright-black:#5a5a68;--nx-ansi-bright-red:#ff8b83;--nx-ansi-bright-green:#7de0a3;
--nx-ansi-bright-yellow:#f2c95c;--nx-ansi-bright-blue:#9ab8ff;--nx-ansi-bright-magenta:#e0a5f5;
--nx-ansi-bright-cyan:#7adcea;--nx-ansi-bright-white:#ffffff;
}`;

let paletteInserted = false;

function ensurePalette(): void {
  if (paletteInserted || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.setAttribute("data-nx-ansi-palette", "");
  style.textContent = ANSI_CSS;
  document.head.appendChild(style);
  paletteInserted = true;
}

const blink = keyframes({ "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.25 } });

const rootClass = css({
  display: "flex",
  flexDirection: "column",
  borderRadius: theme.radius.md,
  border: `1px solid ${theme.color.border}`,
  backgroundColor: theme.color.card,
  overflow: "hidden",
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
});

const runClass = css({
  borderTop: `1px solid ${theme.color.border}`,
  "&:first-of-type": { borderTop: "none" },
});

const headerClass = css({
  display: "flex",
  alignItems: "center",
  gap: theme.space[2],
  width: "100%",
  padding: `${theme.space[2]} ${theme.space[3]}`,
  border: "none",
  background: "transparent",
  color: theme.color.foreground,
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  transitionProperty: "background-color",
  transitionDuration: theme.duration.fast,
  "&:hover": { backgroundColor: theme.color.muted },
  "&:focus-visible": { outline: `2px solid ${theme.color.ring}`, outlineOffset: "-2px" },
});

const chevronClass = css({
  flexShrink: 0,
  transitionProperty: "transform",
  transitionDuration: theme.duration.fast,
  '[data-open="true"] > &': { transform: "rotate(90deg)" },
});

const promptClass = css({ color: theme.color.mutedForeground, flexShrink: 0, userSelect: "none" });

const commandClass = css({
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: theme.fontWeight.medium,
});

const cwdClass = css({
  color: theme.color.mutedForeground,
  flexShrink: 0,
  maxWidth: "12rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const badgeClass = css({
  display: "inline-flex",
  alignItems: "center",
  gap: theme.space[1],
  flexShrink: 0,
  padding: `1px ${theme.space[1.5]}`,
  borderRadius: theme.radius.sm,
  fontSize: "0.6875rem",
  fontFamily: theme.fontFamily.sans,
  fontWeight: theme.fontWeight.medium,
  fontVariantNumeric: "tabular-nums",
});

const durationClass = css({
  color: theme.color.mutedForeground,
  flexShrink: 0,
  fontVariantNumeric: "tabular-nums",
});

const outputClass = css({
  margin: 0,
  padding: `${theme.space[2]} ${theme.space[3]} ${theme.space[3]}`,
  overflowX: "auto",
  overflowY: "auto",
  whiteSpace: "pre",
  lineHeight: 1.55,
  color: theme.color.foreground,
  backgroundColor: theme.color.muted,
});

const runningDotClass = css({
  width: "6px",
  height: "6px",
  borderRadius: "9999px",
  backgroundColor: "currentColor",
  animation: `${blink} 1s ${theme.easing.standard} infinite`,
});

const caretClass = css({
  display: "inline-block",
  width: "0.5em",
  height: "1em",
  verticalAlign: "text-bottom",
  backgroundColor: theme.color.primary,
  animation: `${blink} 1.1s steps(1, end) infinite`,
});

const emptyClass = css({
  padding: `${theme.space[3]} ${theme.space[3]} ${theme.space[4]}`,
  color: theme.color.mutedForeground,
  fontStyle: "italic",
});

const STATUS_COLOR: Record<RunStatus, string> = {
  running: theme.color.primary,
  success: theme.color.success,
  failed: theme.color.destructive,
  cancelled: theme.color.mutedForeground,
};

function statusLabel(run: TerminalRun): string {
  if (run.status === "running") return "running";
  if (run.status === "cancelled") return "cancelled";
  if (run.status === "failed") return run.exitCode !== undefined ? `exit ${run.exitCode}` : "failed";
  return run.exitCode !== undefined && run.exitCode !== 0 ? `exit ${run.exitCode}` : "exit 0";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function styleToCss(style: AnsiStyle): CSSProperties {
  // Inverse swaps fg/bg at render time rather than at parse time, so toggling
  // SGR 27 later restores the original colours instead of losing them.
  const color = style.inverse ? (style.background ?? theme.color.background) : style.color;
  const background = style.inverse ? (style.color ?? theme.color.foreground) : style.background;

  return {
    color,
    backgroundColor: background,
    fontWeight: style.bold ? 600 : undefined,
    opacity: style.dim ? 0.6 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textDecoration:
      style.underline && style.strike
        ? "underline line-through"
        : style.underline
          ? "underline"
          : style.strike
            ? "line-through"
            : undefined,
  };
}

function AnsiOutput({ text, showCaret }: { text: string; showCaret: boolean }) {
  ensurePalette();

  const lines = useMemo(() => {
    const collapsed = splitTerminalLines(text);
    // Style carries across lines: a colour opened on one line stays open until
    // reset, which multi-line tool output relies on.
    let style: AnsiStyle = {};
    return collapsed.map((line) => {
      const parsed = parseAnsi(line, style);
      style = parsed.style;
      return parsed.spans;
    });
  }, [text]);

  return (
    <>
      {lines.map((spans, lineIndex) => (
        <div key={lineIndex}>
          {spans.map((span, spanIndex) =>
            span.style.hidden ? (
              <span key={spanIndex} aria-hidden="true">
                {" ".repeat(span.text.length)}
              </span>
            ) : (
              <span key={spanIndex} style={styleToCss(span.style)}>
                {span.text}
              </span>
            ),
          )}
          {showCaret && lineIndex === lines.length - 1 ? (
            <span className={caretClass} aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export interface TerminalSurfaceProps {
  runs: TerminalRun[];
  /** Run ids to render expanded. Defaults to the last run plus any failures. */
  defaultOpen?: string[];
  /** Max height of each run's output before it scrolls. */
  maxOutputHeight?: number | string;
  /** Follow output as it streams. Pauses automatically when scrolled up. */
  autoScroll?: boolean;
  /** Prompt glyph shown before each command. */
  prompt?: string;
  label?: string;
  className?: string;
  /** Rendered when there are no runs. */
  empty?: ReactNode;
}

/**
 * Streaming command output with ANSI colour, exit codes, and collapsible runs.
 *
 * Failed runs default to expanded and successful ones to collapsed: a green
 * build is noise, a red one is the reason the user is looking at all.
 */
export function TerminalSurface({
  runs,
  defaultOpen,
  maxOutputHeight = 320,
  autoScroll = true,
  prompt = "$",
  label = "Command output",
  className,
  empty,
}: TerminalSurfaceProps) {
  const initialOpen = useMemo(() => {
    if (defaultOpen) return new Set(defaultOpen);
    const open = new Set<string>();
    for (const run of runs) {
      if (run.status === "failed" || run.status === "running") open.add(run.id);
    }
    const last = runs[runs.length - 1];
    if (last) open.add(last.id);
    return open;
  }, [defaultOpen, runs]);

  const [open, setOpen] = useState<Set<string>>(initialOpen);

  // Newly-arriving runs should follow the same default as the initial ones,
  // without clobbering what the user has since toggled.
  const seenRef = useRef<Set<string>>(new Set(runs.map((run) => run.id)));
  useEffect(() => {
    const unseen = runs.filter((run) => !seenRef.current.has(run.id));
    if (unseen.length === 0) return;
    for (const run of unseen) seenRef.current.add(run.id);
    setOpen((prev) => {
      const next = new Set(prev);
      for (const run of unseen) {
        if (run.status === "failed" || run.status === "running") next.add(run.id);
      }
      return next;
    });
  }, [runs]);

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (runs.length === 0) {
    return (
      <div className={className ? `${rootClass} ${className}` : rootClass} aria-label={label}>
        <div className={emptyClass}>{empty ?? "No commands run yet."}</div>
      </div>
    );
  }

  return (
    <div className={className ? `${rootClass} ${className}` : rootClass} aria-label={label} role="log">
      {runs.map((run) => {
        const isOpen = open.has(run.id);
        const color = STATUS_COLOR[run.status];

        return (
          <div key={run.id} className={runClass}>
            <button
              type="button"
              className={headerClass}
              data-open={isOpen}
              aria-expanded={isOpen}
              onClick={() => toggle(run.id)}
            >
              <svg className={chevronClass} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M4.5 3L8 6l-3.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>

              {run.cwd ? <span className={cwdClass}>{run.cwd}</span> : null}
              <span className={promptClass}>{prompt}</span>
              <span className={commandClass}>{run.command}</span>

              {run.durationMs !== undefined && run.status !== "running" ? (
                <span className={durationClass}>{formatDuration(run.durationMs)}</span>
              ) : null}

              <span
                className={badgeClass}
                style={{ color, backgroundColor: "transparent", border: `1px solid ${color}` }}
              >
                {run.status === "running" ? <span className={runningDotClass} aria-hidden="true" /> : null}
                {statusLabel(run)}
              </span>
            </button>

            {isOpen ? (
              <RunOutput
                text={run.output}
                running={run.status === "running"}
                autoScroll={autoScroll}
                maxHeight={maxOutputHeight}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RunOutput({
  text,
  running,
  autoScroll,
  maxHeight,
}: {
  text: string;
  running: boolean;
  autoScroll: boolean;
  maxHeight: number | string;
}) {
  const ref = useRef<HTMLPreElement | null>(null);
  const pinnedRef = useRef(true);

  // Follow the tail only while the user is already at the bottom. Yanking the
  // view back down while someone is reading earlier output is the single most
  // irritating thing a log pane can do.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !autoScroll || !pinnedRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [text, autoScroll]);

  const onScroll = () => {
    const node = ref.current;
    if (!node) return;
    // A small slack so a fractional scroll position still counts as pinned.
    pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
  };

  return (
    <pre
      ref={ref}
      className={outputClass}
      style={{ maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight }}
      onScroll={onScroll}
      tabIndex={0}
    >
      {text.length === 0 && running ? (
        <span className={caretClass} aria-hidden="true" />
      ) : (
        <AnsiOutput text={text} showCaret={running} />
      )}
    </pre>
  );
}
