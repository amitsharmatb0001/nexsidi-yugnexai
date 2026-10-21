// Planting known defects in code, to train and measure the checkers (patent claim 4).
//
// A checker that is never tested against defects it should find cannot be told apart from one that finds nothing. These
// mutations put a known defect into a COPY of generated code (the text is returned; nothing on disk is touched), at five
// levels of difficulty:
//   1  obvious     a line anyone would flag (eval of text, a password in the code)
//   2  one line    a small change on a single line (SQL built from text, a weak hash)
//   3  logic       something is missing or wrong in the flow (a sign-in check removed, a loop one past the end, errors swallowed)
//   4  structure   a problem that needs the whole file (memory that grows with every request, request data used unchecked)
//   5  subtle      a change that looks reasonable (the owner filter dropped from a query, the role taken from the client)
// Each planted defect is recorded with where it is and a hint for recognising a finding about it, so the result can be judged.
import { createHash } from "node:crypto";

export type Level = 1 | 2 | 3 | 4 | 5;

export interface Mutation {
  operator: string;
  level: Level;
  description: string;
  /** Words a finding about this defect would use. */
  hint: RegExp;
  applicable(source: string): boolean;
  apply(source: string): { source: string; line: number; before: string; after: string } | null;
}

export interface PlantedDefect {
  id: string;
  operator: string;
  level: Level;
  file: string;
  line: number;
  description: string;
  hint: string;
  before: string;
  after: string;
}

const lineAt = (src: string, index: number) => src.slice(0, index).split("\n").length;
const lineText = (src: string, line: number) => (src.split("\n")[line - 1] ?? "").trim();

/** Index of the brace that closes the one opened at `open`. Strings and comments are not special-cased. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function replaceAt(src: string, start: number, end: number, text: string, before: string): { source: string; line: number; before: string; after: string } {
  const source = src.slice(0, start) + text + src.slice(end);
  const line = lineAt(source, start);
  return { source, line, before, after: lineText(source, line) };
}

function append(src: string, line: string) {
  const base = src.endsWith("\n") ? src : `${src}\n`;
  const source = `${base}${line}\n`;
  return { source, line: lineAt(source, base.length), before: "", after: line };
}

function make(m: Omit<Mutation, "applicable">): Mutation {
  return { ...m, applicable: (s) => m.apply(s) !== null };
}

export const MUTATIONS: Mutation[] = [
  make({
    operator: "eval-call", level: 1, hint: /eval|code execution|arbitrary code|injection/i,
    description: "A function that runs text it is given as code (eval) is added.",
    apply: (s) => append(s, "export const runUserCode = (code: string) => eval(code);"),
  }),
  make({
    operator: "hardcoded-secret", level: 1, hint: /hard-?coded|secret|password|credential/i,
    description: "An administrator password is written into the code.",
    apply: (s) => append(s, 'const ADMIN_PASSWORD = "Sup3rS3cret-Admin-2024";'),
  }),
  make({
    operator: "sql-concat", level: 2, hint: /sql|inject|concatenat|parameter|query/i,
    description: "A parameterised query is rewritten to join the value into the SQL text.",
    apply: (s) => {
      const re = /\.query\(\s*(["'`])([^"'`\n]*?)\$1([^"'`\n]*?)\1\s*,\s*\[\s*([A-Za-z_$][\w$.]*)\s*\]\s*\)/g;
      const all = [...s.matchAll(re)];
      const m = all.find((x) => /^\s*select/i.test(x[2]!)) ?? all[0];
      if (!m) return null;
      const [whole, q, a, b, param] = m as unknown as [string, string, string, string, string];
      const text = `.query(${q}${a}${q} + ${param}${b ? ` + ${q}${b}${q}` : ""})`;
      return replaceAt(s, m.index!, m.index! + whole.length, text, lineText(s, lineAt(s, m.index!)));
    },
  }),
  make({
    operator: "weak-hash", level: 2, hint: /md5|weak|hash|crypto|collision/i,
    description: "A SHA-256 hash is changed to MD5.",
    apply: (s) => {
      const m = /createHash\((["'])sha256\1\)/.exec(s);
      return m ? replaceAt(s, m.index, m.index + m[0].length, `createHash(${m[1]}md5${m[1]})`, lineText(s, lineAt(s, m.index))) : null;
    },
  }),
  make({
    operator: "remove-auth-check", level: 3, hint: /auth|unauthor|401|access control|sign.?in|permission|missing check/i,
    description: "The check that the caller is signed in is removed from a route.",
    apply: (s) => {
      const m = /^[ \t]*if\s*\(\s*!\s*(?:req\.user|req\.userId|userId|user)\b[^)]*\)\s*/m.exec(s);
      if (!m) return null;
      const bodyStart = m.index + m[0].length;
      let end: number;
      if (s[bodyStart] === "{") {
        const close = matchBrace(s, bodyStart);
        if (close < 0) return null;
        end = close + 1;
      } else {
        const semi = s.indexOf(";", bodyStart);
        if (semi < 0) return null;
        end = semi + 1;
      }
      if (!/401|nauthorized/.test(s.slice(m.index, end))) return null;
      if (s[end] === "\n") end++;
      // The check is gone; the line that now stands in its place is not what it "became".
      return { ...replaceAt(s, m.index, end, "", lineText(s, lineAt(s, m.index))), after: "" };
    },
  }),
  make({
    operator: "off-by-one", level: 3, hint: /off.?by.?one|bound|index|<=|length|undefined|out of range|past the end/i,
    description: "A loop runs one step past the end of the list.",
    apply: (s) => {
      const m = /for\s*\(\s*(let|var)\s+(\w+)\s*=\s*0\s*;\s*\2\s*<\s*([\w.]+)\.length\s*;/.exec(s);
      if (!m) return null;
      const text = m[0].replace(/<\s*([\w.]+)\.length/, "<= $1.length");
      return replaceAt(s, m.index, m.index + m[0].length, text, lineText(s, lineAt(s, m.index)));
    },
  }),
  make({
    operator: "swallow-error", level: 3, hint: /swallow|ignored|empty catch|error handling|silent|silently/i,
    description: "The handling of a caught error is replaced by nothing.",
    apply: (s) => {
      const re = /catch\s*(?:\(([^)]*)\))?\s*\{/g;
      for (let m = re.exec(s); m; m = re.exec(s)) {
        const open = m.index + m[0].length - 1;
        const close = matchBrace(s, open);
        if (close < 0) continue;
        const body = s.slice(open + 1, close).trim();
        if (body === "" || body === "/* ignored */") continue;
        return replaceAt(s, open + 1, close, " /* ignored */ ", lineText(s, lineAt(s, m.index)));
      }
      return null;
    },
  }),
  make({
    operator: "leak-collection", level: 4, hint: /leak|unbounded|memory|grow|collection|cache|never (cleared|removed)/i,
    description: "A list at the top of the file grows by one entry on every request and is never trimmed.",
    apply: (s) => {
      const h = /(?:app|router)\.(?:get|post|put|patch|delete)\([^\n]*?=>\s*\{\n/.exec(s);
      if (!h) return null;
      const insertAt = h.index + h[0].length;
      const withPush = s.slice(0, insertAt) + "  __recentRequests.push(String(Date.now()));\n" + s.slice(insertAt);
      const importEnd = [...withPush.matchAll(/^import .*$/gm)].reduce((end, x) => Math.max(end, x.index! + x[0].length), 0);
      const decl = "\nconst __recentRequests: string[] = [];\n";
      const source = importEnd > 0 ? withPush.slice(0, importEnd) + decl + withPush.slice(importEnd + 1) : decl.slice(1) + withPush;
      const line = lineAt(source, source.indexOf("__recentRequests.push("));
      return { source, line, before: "", after: "__recentRequests.push(String(Date.now()));" };
    },
  }),
  make({
    operator: "missing-validation", level: 4, hint: /validat|schema|sanitiz|unvalidated|untrusted|unchecked/i,
    description: "The check of the request body against its schema is removed, so the body is used as it arrives.",
    apply: (s) => {
      const m = /\b\w+\.(?:parse|safeParse)\(\s*(req\.body)\s*\)/.exec(s);
      return m ? replaceAt(s, m.index, m.index + m[0].length, m[1]!, lineText(s, lineAt(s, m.index))) : null;
    },
  }),
  make({
    operator: "trust-client-role", level: 5, hint: /role|privilege|trust|client.?controlled|escalat|authoriz/i,
    description: "The caller's role is read from the request body, which the caller controls, instead of from the signed-in user.",
    apply: (s) => {
      const m = /req\.user\??\.role/.exec(s);
      return m ? replaceAt(s, m.index, m.index + m[0].length, "req.body.role", lineText(s, lineAt(s, m.index))) : null;
    },
  }),
  make({
    operator: "drop-ownership-filter", level: 5, hint: /owner|idor|user_id|access control|other users|authoriz|belong/i,
    description: "The condition that limits a query to the signed-in user's own rows is dropped.",
    apply: (s) => {
      const m = / AND (?:user_id|owner_id) = \$\d+/.exec(s);
      return m ? replaceAt(s, m.index, m.index + m[0].length, "", lineText(s, lineAt(s, m.index))) : null;
    },
  }),
];

/** Plants one defect in `source`. Returns the changed text and a record of what was planted, or null if it does not apply. */
export function plantDefect(file: string, source: string, m: Mutation): { source: string; defect: PlantedDefect } | null {
  const out = m.apply(source);
  if (!out) return null;
  const id = createHash("sha256").update(`${file}|${m.operator}|${out.line}`).digest("hex").slice(0, 10);
  return {
    source: out.source,
    defect: { id, operator: m.operator, level: m.level, file, line: out.line, description: m.description, hint: m.hint.source, before: out.before, after: out.after },
  };
}
