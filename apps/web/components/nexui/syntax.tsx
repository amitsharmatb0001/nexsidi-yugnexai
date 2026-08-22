"use client";

import { css, insertRawCss, themeVars as theme } from "@yugnex/core";
import { useMemo, useRef, type ReactNode } from "react";

/* ------------------------------------------------------------------ *
 * Token model
 * ------------------------------------------------------------------ */

export type TokenType =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "operator"
  | "punctuation"
  | "function"
  | "type"
  | "property"
  | "constant"
  | "regexp"
  | "tag"
  | "attribute"
  | "variable"
  | "plain";

export interface Token {
  type: TokenType;
  value: string;
}

export type SyntaxLanguage =
  | "ts"
  | "tsx"
  | "json"
  | "css"
  | "sql"
  | "md"
  | "yaml"
  | "dockerfile"
  | "env"
  | "sh";

/**
 * Carry state between lines. Anything that can span a line break — block
 * comments, template literals, fenced code inside markdown — parks its state
 * here so the next line resumes mid-construct instead of restarting clean.
 */
export type ScanState = "none" | "block-comment" | "template" | "md-fence";

interface Rule {
  type: TokenType;
  /** Must be sticky (`y`) — the scanner anchors every attempt at `lastIndex`. */
  re: RegExp;
  /** Re-type the token when the text immediately after the match starts with `(`. */
  callable?: boolean;
  /** Enter this scan state and consume the rest of the line. */
  enter?: ScanState;
}

/* ------------------------------------------------------------------ *
 * Grammars
 *
 * Deliberately regex-per-token-class rather than a full parser: these drive
 * a *display* surface, and the failure mode of a heuristic lexer (one word
 * tinted wrong) costs nothing, while a real parser would be orders of
 * magnitude more code and still choke on the half-written, mid-stream input
 * this component exists to render.
 * ------------------------------------------------------------------ */

const TS_KEYWORDS =
  "as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|is|keyof|let|new|of|package|private|protected|public|readonly|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield";

const TS_TYPES = "any|bigint|boolean|never|null|number|object|string|symbol|undefined|unknown";
const TS_CONSTANTS = "true|false|null|undefined|NaN|Infinity";

const tsRules: Rule[] = [
  { type: "comment", re: /\/\/[^\n]*/y },
  { type: "comment", re: /\/\*/y, enter: "block-comment" },
  { type: "string", re: /`/y, enter: "template" },
  { type: "string", re: /"(?:[^"\\\n]|\\.)*"?/y },
  { type: "string", re: /'(?:[^'\\\n]|\\.)*'?/y },
  // Regex literals only after a position where a value can't already have ended
  // — otherwise `a / b / c` lexes as a regex. Handled by the scanner's
  // `prevMeaningful` check rather than the pattern itself.
  { type: "regexp", re: /\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[gimsuyd]*/y },
  { type: "number", re: /0[xX][0-9a-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?/y },
  { type: "constant", re: new RegExp(`(?:${TS_CONSTANTS})\\b`, "y") },
  { type: "keyword", re: new RegExp(`(?:${TS_KEYWORDS})\\b`, "y") },
  { type: "type", re: new RegExp(`(?:${TS_TYPES})\\b`, "y") },
  { type: "constant", re: /[A-Z][A-Z0-9_]{2,}\b/y },
  { type: "type", re: /[A-Z][A-Za-z0-9_$]*\b/y },
  { type: "variable", re: /[A-Za-z_$][A-Za-z0-9_$]*/y, callable: true },
  { type: "operator", re: /=>|\.\.\.|\?\?=?|\?\.|[+\-*/%=<>!&|^~?:]+/y },
  { type: "punctuation", re: /[{}[\]();,.@#]/y },
];

const jsonRules: Rule[] = [
  { type: "property", re: /"(?:[^"\\\n]|\\.)*"?(?=\s*:)/y },
  { type: "string", re: /"(?:[^"\\\n]|\\.)*"?/y },
  { type: "number", re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y },
  { type: "constant", re: /(?:true|false|null)\b/y },
  { type: "punctuation", re: /[{}[\]:,]/y },
];

const cssRules: Rule[] = [
  { type: "comment", re: /\/\*/y, enter: "block-comment" },
  { type: "string", re: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/y },
  { type: "keyword", re: /@[a-zA-Z-]+/y },
  { type: "number", re: /#[0-9a-fA-F]{3,8}\b/y },
  { type: "number", re: /-?\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|ex|pt|cm|mm|in|pc|turn|rad)?/y },
  { type: "property", re: /--[a-zA-Z0-9-]+/y },
  { type: "property", re: /[a-zA-Z-]+(?=\s*:)/y },
  { type: "function", re: /[a-zA-Z-]+(?=\()/y },
  { type: "tag", re: /[.#]?[a-zA-Z][a-zA-Z0-9_-]*/y },
  { type: "punctuation", re: /[{}();:,]/y },
  { type: "operator", re: /[>+~*=]/y },
];

const SQL_KEYWORDS =
  "add|all|alter|and|any|as|asc|begin|between|by|case|cast|check|column|commit|constraint|create|cross|database|default|delete|desc|distinct|drop|else|end|exists|foreign|from|full|group|having|if|in|index|inner|insert|into|is|join|key|left|like|limit|not|null|offset|on|or|order|outer|primary|references|returning|right|rollback|select|set|table|then|transaction|union|unique|update|values|view|when|where|with";

const sqlRules: Rule[] = [
  { type: "comment", re: /--[^\n]*/y },
  { type: "comment", re: /\/\*/y, enter: "block-comment" },
  { type: "string", re: /'(?:[^'\\\n]|\\.|'')*'?/y },
  { type: "property", re: /"(?:[^"\n]|"")*"?|`[^`\n]*`?/y },
  { type: "number", re: /\d+(?:\.\d+)?/y },
  { type: "keyword", re: new RegExp(`(?:${SQL_KEYWORDS})\\b`, "iy") },
  { type: "function", re: /[a-zA-Z_][a-zA-Z0-9_]*(?=\()/y },
  { type: "variable", re: /[a-zA-Z_][a-zA-Z0-9_$]*/y },
  { type: "operator", re: /<>|!=|>=|<=|[=<>+\-*/%|]/y },
  { type: "punctuation", re: /[();,.]/y },
];

const yamlRules: Rule[] = [
  { type: "comment", re: /#[^\n]*/y },
  { type: "punctuation", re: /^\s*-\s/y },
  { type: "property", re: /[A-Za-z_][\w.-]*(?=\s*:)/y },
  { type: "string", re: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\n]|'')*'?/y },
  { type: "constant", re: /\b(?:true|false|null|yes|no|on|off|~)\b/iy },
  { type: "number", re: /-?\d+(?:\.\d+)?\b/y },
  { type: "keyword", re: /[&*][\w-]+|<</y },
  { type: "punctuation", re: /[:{}[\],|>]/y },
];

const DOCKER_INSTRUCTIONS =
  "ADD|ARG|CMD|COPY|ENTRYPOINT|ENV|EXPOSE|FROM|HEALTHCHECK|LABEL|MAINTAINER|ONBUILD|RUN|SHELL|STOPSIGNAL|USER|VOLUME|WORKDIR";

const dockerfileRules: Rule[] = [
  { type: "comment", re: /#[^\n]*/y },
  { type: "keyword", re: new RegExp(`^\\s*(?:${DOCKER_INSTRUCTIONS})\\b`, "iy") },
  { type: "constant", re: /\bAS\b/iy },
  { type: "string", re: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/y },
  { type: "variable", re: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/y },
  { type: "number", re: /\b\d+(?:\.\d+)*\b/y },
  { type: "operator", re: /[=:@\\]/y },
  { type: "punctuation", re: /[[\],]/y },
];

const envRules: Rule[] = [
  { type: "comment", re: /#[^\n]*/y },
  { type: "keyword", re: /^\s*export\b/y },
  { type: "property", re: /^\s*[A-Za-z_][A-Za-z0-9_]*(?=\s*=)/y },
  { type: "operator", re: /=/y },
  { type: "string", re: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\n])*'?/y },
  { type: "variable", re: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/y },
];

const SH_KEYWORDS =
  "if|then|else|elif|fi|for|while|until|do|done|case|esac|function|return|in|select|time|coproc|break|continue|local|export|readonly|declare|typeset|unset|shift|source|alias|trap|set";

const SH_BUILTINS =
  "echo|printf|read|cd|pwd|ls|cat|grep|sed|awk|cut|sort|uniq|head|tail|wc|find|xargs|chmod|chown|mkdir|rm|cp|mv|touch|test|kill|ps|curl|wget|git|npm|pnpm|yarn|node|docker|make";

const shRules: Rule[] = [
  { type: "comment", re: /#[^\n]*/y },
  { type: "string", re: /"(?:[^"\\\n]|\\.)*"?/y },
  { type: "string", re: /'[^'\n]*'?/y },
  { type: "variable", re: /\$\{[^}\n]*\}?|\$[A-Za-z_][A-Za-z0-9_]*|\$[?@#*!$0-9]/y },
  { type: "keyword", re: new RegExp(`(?:${SH_KEYWORDS})\\b`, "y") },
  { type: "function", re: new RegExp(`(?:${SH_BUILTINS})\\b`, "y") },
  { type: "attribute", re: /(?:^|\s)--?[A-Za-z][\w-]*/y },
  { type: "number", re: /\b\d+\b/y },
  { type: "operator", re: /&&|\|\||[|<>&;=!]/y },
  { type: "punctuation", re: /[(){}[\]]/y },
  { type: "plain", re: /[A-Za-z_./-][\w./-]*/y },
];

/** JSX/TSX adds tag + attribute classes on top of the TypeScript rules. */
const tsxRules: Rule[] = [
  { type: "comment", re: /\/\/[^\n]*/y },
  { type: "comment", re: /\/\*/y, enter: "block-comment" },
  { type: "string", re: /`/y, enter: "template" },
  { type: "tag", re: /<\/?[A-Za-z][\w.]*|\/?>/y },
  ...tsRules.slice(3),
];

const GRAMMARS: Record<Exclude<SyntaxLanguage, "md">, Rule[]> = {
  ts: tsRules,
  tsx: tsxRules,
  json: jsonRules,
  css: cssRules,
  sql: sqlRules,
  yaml: yamlRules,
  dockerfile: dockerfileRules,
  env: envRules,
  sh: shRules,
};

/* ------------------------------------------------------------------ *
 * Scanner
 * ------------------------------------------------------------------ */

/** Tokens after which a `/` starts a regex literal rather than division. */
const REGEX_PRECEDING = new Set<TokenType>(["operator", "punctuation", "keyword"]);

/**
 * `from` is where the emitted token starts; `scanFrom` is where the search for
 * the terminator starts. They differ when the delimiter is being *opened* on
 * this line — the opener itself must not be mistaken for the closer.
 *
 * Without the split, a slash-star-slash line reads as a complete comment (the
 * opener's own slash gets matched as the terminator's), and a backtick opening
 * a template literal immediately closes itself.
 */
function closeBlockComment(line: string, from: number, scanFrom: number): { token: Token; next: number; state: ScanState } {
  const end = line.indexOf("*/", scanFrom);
  if (end === -1) return { token: { type: "comment", value: line.slice(from) }, next: line.length, state: "block-comment" };
  return { token: { type: "comment", value: line.slice(from, end + 2) }, next: end + 2, state: "none" };
}

/** Walks a template literal to its closing backtick, respecting escapes. */
function closeTemplate(line: string, from: number, scanFrom: number): { token: Token; next: number; state: ScanState } {
  let i = scanFrom;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") return { token: { type: "string", value: line.slice(from, i + 1) }, next: i + 1, state: "none" };
    i += 1;
  }
  return { token: { type: "string", value: line.slice(from) }, next: line.length, state: "template" };
}

export interface LineTokens {
  tokens: Token[];
  /** Scan state to feed into the next line. */
  endState: ScanState;
}

/**
 * Tokenizes exactly one line, resuming from `startState`.
 *
 * Line-at-a-time is what makes the whole thing incremental: a streamed file
 * only ever invalidates the line currently being appended to (and any
 * following lines *if* its end state changed), so re-highlighting a 2000-line
 * file as its last line grows costs one line of work, not 2000.
 */
export function tokenizeLine(line: string, language: SyntaxLanguage, startState: ScanState = "none"): LineTokens {
  if (language === "md") return tokenizeMarkdownLine(line, startState);

  const rules = GRAMMARS[language];
  const tokens: Token[] = [];
  let index = 0;
  let state = startState;

  // Resuming: the delimiter was opened on an earlier line, so token start and
  // scan start are both 0 — there is no opener on this line to skip past.
  if (state === "block-comment") {
    const r = closeBlockComment(line, 0, 0);
    tokens.push(r.token);
    index = r.next;
    state = r.state;
  } else if (state === "template") {
    const r = closeTemplate(line, 0, 0);
    tokens.push(r.token);
    index = r.next;
    state = r.state;
  }

  let lastMeaningful: TokenType | null = null;

  while (index < line.length) {
    const ws = /\s+/y;
    ws.lastIndex = index;
    const wsMatch = ws.exec(line);
    if (wsMatch) {
      tokens.push({ type: "plain", value: wsMatch[0] });
      index = ws.lastIndex;
      continue;
    }

    let matched = false;

    for (const rule of rules) {
      // Division vs. regex is genuinely ambiguous without a parser; use the
      // preceding meaningful token as the tiebreak, which is what every
      // regex-based JS lexer settles on.
      if (rule.type === "regexp" && lastMeaningful !== null && !REGEX_PRECEDING.has(lastMeaningful)) continue;

      rule.re.lastIndex = index;
      const match = rule.re.exec(line);
      if (!match || match.index !== index || match[0].length === 0) continue;

      // Opening on this line: skip the opener before looking for the closer.
      if (rule.enter === "block-comment") {
        const r = closeBlockComment(line, index, index + 2);
        tokens.push(r.token);
        index = r.next;
        state = r.state;
        lastMeaningful = "comment";
        matched = true;
        break;
      }

      if (rule.enter === "template") {
        const r = closeTemplate(line, index, index + 1);
        tokens.push(r.token);
        index = r.next;
        state = r.state;
        lastMeaningful = "string";
        matched = true;
        break;
      }

      let type = rule.type;
      if (rule.callable && line[index + match[0].length] === "(") type = "function";

      tokens.push({ type, value: match[0] });
      index += match[0].length;
      lastMeaningful = type;
      matched = true;
      break;
    }

    if (!matched) {
      // Unknown character: emit it as plain and advance, so a grammar gap can
      // never wedge the scanner in an infinite loop.
      tokens.push({ type: "plain", value: line[index] as string });
      index += 1;
      lastMeaningful = "plain";
    }
  }

  return { tokens, endState: state };
}

/* ------------------------------------------------------------------ *
 * Markdown (its own scanner — line-oriented, not token-oriented)
 * ------------------------------------------------------------------ */

function tokenizeMarkdownLine(line: string, startState: ScanState): LineTokens {
  if (startState === "md-fence") {
    if (/^\s*```/.test(line)) return { tokens: [{ type: "keyword", value: line }], endState: "none" };
    return { tokens: [{ type: "plain", value: line }], endState: "md-fence" };
  }

  if (/^\s*```/.test(line)) return { tokens: [{ type: "keyword", value: line }], endState: "md-fence" };
  if (/^\s{0,3}#{1,6}\s/.test(line)) return { tokens: [{ type: "keyword", value: line }], endState: "none" };
  if (/^\s{0,3}>/.test(line)) return { tokens: [{ type: "comment", value: line }], endState: "none" };
  if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) return { tokens: [{ type: "punctuation", value: line }], endState: "none" };

  const tokens: Token[] = [];
  let rest = line;

  const bullet = /^(\s*)([-*+]|\d+\.)(\s+)/.exec(rest);
  if (bullet) {
    tokens.push({ type: "plain", value: bullet[1] as string });
    tokens.push({ type: "punctuation", value: bullet[2] as string });
    tokens.push({ type: "plain", value: bullet[3] as string });
    rest = rest.slice(bullet[0].length);
  }

  const inline = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]*\]\([^)]*\))/g;
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = inline.exec(rest)) !== null) {
    if (m.index > cursor) tokens.push({ type: "plain", value: rest.slice(cursor, m.index) });
    if (m[1]) tokens.push({ type: "string", value: m[1] });
    else if (m[2]) tokens.push({ type: "constant", value: m[2] });
    else if (m[3]) tokens.push({ type: "type", value: m[3] });
    else if (m[4]) tokens.push({ type: "function", value: m[4] });
    cursor = m.index + m[0].length;
  }

  if (cursor < rest.length) tokens.push({ type: "plain", value: rest.slice(cursor) });

  return { tokens, endState: "none" };
}

/* ------------------------------------------------------------------ *
 * Incremental document tokenizer
 * ------------------------------------------------------------------ */

interface CachedLine {
  text: string;
  inState: ScanState;
  result: LineTokens;
}

/**
 * Tokenizes a whole document, reusing per-line results across calls.
 *
 * Keep one instance per file (see `useSyntax`). Re-tokenizing after an append
 * touches only the lines whose text *or* incoming scan state changed — the
 * common streaming case where the last line grows re-scans exactly one line.
 */
export class IncrementalTokenizer {
  private cache: CachedLine[] = [];

  constructor(private language: SyntaxLanguage) {}

  setLanguage(language: SyntaxLanguage): void {
    if (language === this.language) return;
    this.language = language;
    this.cache = [];
  }

  tokenize(source: string): Token[][] {
    const lines = source.split("\n");
    const out: Token[][] = [];
    let state: ScanState = "none";

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i] as string;
      const cached = this.cache[i];

      if (cached && cached.text === text && cached.inState === state) {
        out.push(cached.result.tokens);
        state = cached.result.endState;
        continue;
      }

      const result = tokenizeLine(text, this.language, state);
      this.cache[i] = { text, inState: state, result };
      out.push(result.tokens);
      state = result.endState;
    }

    if (this.cache.length > lines.length) this.cache.length = lines.length;
    return out;
  }
}

/** Guesses a grammar from a filename. Falls back to `ts` for unknown code-ish files. */
export function languageFromFilename(filename: string): SyntaxLanguage {
  const name = filename.split("/").pop() ?? filename;
  const lower = name.toLowerCase();

  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  if (lower === ".env" || lower.startsWith(".env.")) return "env";

  const ext = lower.includes(".") ? (lower.split(".").pop() as string) : "";
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
    case "js":
    case "mjs":
    case "cjs":
      return "ts";
    case "tsx":
    case "jsx":
      return "tsx";
    case "json":
    case "jsonc":
      return "json";
    case "css":
    case "scss":
    case "less":
      return "css";
    case "sql":
      return "sql";
    case "md":
    case "mdx":
    case "markdown":
      return "md";
    case "yaml":
    case "yml":
      return "yaml";
    case "sh":
    case "bash":
    case "zsh":
      return "sh";
    default:
      return "ts";
  }
}

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */

const SYNTAX_CSS = `
:root{
--nx-syn-keyword:#8b5cf6;--nx-syn-string:#0f8a54;--nx-syn-number:#b4500a;
--nx-syn-comment:#8b8b96;--nx-syn-operator:#5b5b66;--nx-syn-punct:#8b8b96;
--nx-syn-function:#2563c9;--nx-syn-type:#0e7490;--nx-syn-property:#b0221d;
--nx-syn-constant:#a21caf;--nx-syn-regexp:#0f8a54;--nx-syn-tag:#b0221d;
--nx-syn-attribute:#b4500a;--nx-syn-variable:inherit;
}
[data-theme="dark"]{
--nx-syn-keyword:#c4b5fd;--nx-syn-string:#78e5a8;--nx-syn-number:#fbb324;
--nx-syn-comment:#7b7b88;--nx-syn-operator:#b8b8c4;--nx-syn-punct:#8b8b99;
--nx-syn-function:#8ab4f8;--nx-syn-type:#5ed3e8;--nx-syn-property:#f7a6a4;
--nx-syn-constant:#f0abfc;--nx-syn-regexp:#78e5a8;--nx-syn-tag:#f7a6a4;
--nx-syn-attribute:#fccc4d;--nx-syn-variable:inherit;
}`;

let paletteInserted = false;

function ensurePalette(): void {
  if (paletteInserted) return;
  insertRawCss("base", "nx-syntax-palette", SYNTAX_CSS);
  paletteInserted = true;
}

const TOKEN_COLOR: Record<TokenType, string> = {
  keyword: "var(--nx-syn-keyword)",
  string: "var(--nx-syn-string)",
  number: "var(--nx-syn-number)",
  comment: "var(--nx-syn-comment)",
  operator: "var(--nx-syn-operator)",
  punctuation: "var(--nx-syn-punct)",
  function: "var(--nx-syn-function)",
  type: "var(--nx-syn-type)",
  property: "var(--nx-syn-property)",
  constant: "var(--nx-syn-constant)",
  regexp: "var(--nx-syn-regexp)",
  tag: "var(--nx-syn-tag)",
  attribute: "var(--nx-syn-attribute)",
  variable: "var(--nx-syn-variable)",
  plain: "inherit",
};

const commentClass = css({ fontStyle: "italic" });

/** Renders one already-tokenized line. Exported so diff-view can reuse it per side. */
export function TokenLine({ tokens }: { tokens: Token[] }): ReactNode {
  ensurePalette();
  return (
    <>
      {tokens.map((token, i) => {
        if (token.type === "plain") return <span key={i}>{token.value}</span>;
        return (
          <span
            key={i}
            style={{ color: TOKEN_COLOR[token.type] }}
            className={token.type === "comment" ? commentClass : undefined}
          >
            {token.value}
          </span>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Hook + component
 * ------------------------------------------------------------------ */

/** Tokenizes `code`, reusing one tokenizer instance so streaming stays incremental. */
export function useSyntax(code: string, language: SyntaxLanguage): Token[][] {
  const ref = useRef<IncrementalTokenizer | null>(null);
  if (ref.current === null) ref.current = new IncrementalTokenizer(language);
  const tokenizer = ref.current;
  tokenizer.setLanguage(language);
  return useMemo(() => tokenizer.tokenize(code), [code, language, tokenizer]);
}

const rootClass = css({
  fontFamily: theme.fontFamily.mono,
  fontSize: theme.fontSize.xs,
  lineHeight: 1.65,
  color: theme.color.foreground,
  overflowX: "auto",
  tabSize: 2,
});

const lineClass = css({ display: "flex", whiteSpace: "pre" });

const gutterClass = css({
  flexShrink: 0,
  userSelect: "none",
  textAlign: "right",
  paddingRight: theme.space[3],
  color: theme.color.mutedForeground,
  fontVariantNumeric: "tabular-nums",
  position: "sticky",
  left: 0,
  backgroundColor: "inherit",
});

export interface SyntaxProps {
  code: string;
  language?: SyntaxLanguage;
  /** Used to infer the language when `language` is omitted. */
  filename?: string;
  showLineNumbers?: boolean;
  /** 1-based line numbers to tint as active — e.g. the line being written. */
  highlightLines?: number[];
  className?: string;
}

/**
 * Syntax-highlighted code, tokenized incrementally so it stays cheap while the
 * source is still streaming in.
 */
export function Syntax({
  code,
  language,
  filename,
  showLineNumbers = false,
  highlightLines,
  className,
}: SyntaxProps) {
  const resolved = language ?? (filename ? languageFromFilename(filename) : "ts");
  const lines = useSyntax(code, resolved);
  const highlighted = useMemo(() => new Set(highlightLines ?? []), [highlightLines]);
  const width = `${String(lines.length).length}ch`;

  return (
    <pre className={className ? `${rootClass} ${className}` : rootClass}>
      <code>
        {lines.map((tokens, i) => (
          <div
            key={i}
            className={lineClass}
            style={highlighted.has(i + 1) ? { backgroundColor: theme.color.accent } : undefined}
          >
            {showLineNumbers ? (
              <span className={gutterClass} style={{ width }}>
                {i + 1}
              </span>
            ) : null}
            <span>
              <TokenLine tokens={tokens} />
            </span>
          </div>
        ))}
      </code>
    </pre>
  );
}
