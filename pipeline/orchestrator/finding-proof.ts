// Proof gate for review findings (2026-10-24, docs/root-cause/2026-10-24-brewline.md). In Brewline's last live round 4
// of 5 findings were false: the checker quoted code that is not in the project ("app.use(cors());"), cited files that do
// not exist (backend/src/routes/auth.ts) and endpoints that are not in the approved contract (/api/auth/login), and each
// one still started a paid fix round. Nothing checked a live finding against the code.
//
// A finding is dropped only when the project's own files prove part of it false AND nothing in it checks out:
//   - it quotes code (a backtick span that reads as code) that is in no project file, or
//   - every source file it cites is missing, or
//   - every API path it names is outside the approved contract and the app's own frontend never calls it.
// A finding with no checkable claim is kept: this gate removes proven falsehoods, it never judges importance. Quotes
// written as absences ("does not call `x()`", "instead of `y`") are not checked. Deterministic; no model call.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DIRS = ["frontend", "backend", "db"];
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".git", "coverage"]);
const SOURCE_EXT = /\.(tsx?|jsx?|mjs|cjs|css|sql|json)$/i;

export interface ProofContext {
  /** lower-cased relative path -> whitespace-free lower-cased content */
  files: Map<string, string>;
  basenames: Set<string>;
  /** lower-cased frontend source, for "does the app call this endpoint" */
  frontendSource: string;
  /** normalised contract paths, or null when there is no contract */
  contract: string[] | null;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const normPath = (p: string) =>
  p.toLowerCase().split("?")[0]!.replace(/\/+$/, "").split("/").map((s) => (/^(:|\{|\$|\[|<)/.test(s) ? "*" : s)).join("/");

export function buildProofContext(projectDir: string): ProofContext {
  const files = new Map<string, string>();
  const basenames = new Set<string>();
  let frontendSource = "";
  const walk = (rel: string) => {
    let names: string[];
    try {
      names = readdirSync(join(projectDir, rel));
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const r = `${rel}/${n}`;
      let isDir = false;
      try {
        isDir = statSync(join(projectDir, r)).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(r);
      else if (SOURCE_EXT.test(n) || n.startsWith(".env")) {
        let body = "";
        try {
          body = readFileSync(join(projectDir, r), "utf-8");
        } catch {
          continue;
        }
        files.set(r.toLowerCase(), squash(body));
        basenames.add(n.toLowerCase());
        if (r.startsWith("frontend/")) frontendSource += body.toLowerCase() + "\n";
      }
    }
  };
  for (const d of SOURCE_DIRS) walk(d);
  let contract: string[] | null = null;
  const contractFile = join(projectDir, "api-contract.json");
  if (existsSync(contractFile)) {
    try {
      const c = JSON.parse(readFileSync(contractFile, "utf-8")) as { endpoints?: Array<{ path?: string }> };
      contract = (c.endpoints ?? []).filter((e) => e.path).map((e) => normPath(e.path!));
    } catch {
      contract = null;
    }
  }
  return { files, basenames, frontendSource, contract };
}

const ABSENCE = /\b(not|no|missing|without|never|lacks?|lacking|instead of|rather than|should|must|expected|neither|nor|absent|undefined|omits?|omitting)\b/i;
const SUGGESTION = /\b(use|using|e\.g\.?|such as|for example|like|recommend\w*|consider|replace\w*|switch to|should be|instead)\b[^`]{0,30}$/i;
const CONDITION = /\b(when|if|unless|whether|whenever)\b[^`]{0,20}$/i;
const CODE_CHARS = /[(){}=;<>[\]]|[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*/;
const PATH_LIKE = /^[\w.\-/[\]()@]+\.(tsx?|jsx?|mjs|cjs|css|sql|json|png|jpe?g|svg|webp|gif|md)$/i;
const CITED_FILE = /(?:^|[\s`'"(,])((?:frontend|backend|db)\/[\w.\-/[\]()@]+\.(?:tsx?|jsx?|mjs|cjs|css|sql|json))/gi;
const API_PATH = /(?:^|[\s`'"(])(?:(?:get|post|put|patch|delete)\s+['"`]?)?(?:https?:\/\/[^\s/`'"]+)?(\/api\/[\w\-/:{}$.<>]+)/gi;

export function citedFiles(text: string): string[] {
  return [...new Set([...text.matchAll(CITED_FILE)].map((m) => m[1]!.toLowerCase().replace(/[).,]+$/, "")))];
}

function apiPaths(text: string): string[] {
  return [...new Set([...text.matchAll(API_PATH)].map((m) => m[1]!.replace(/[).,]+$/, "")))];
}

function contractHas(contract: string[], path: string): boolean {
  // "/api/gear" for a contract's "/api/v1/gear" is the same endpoint written loosely, not an unknown one.
  const withVersion = normPath(path).replace(/^\/api\/(?!v\d+\/)/, "/api/v1/");
  return matchesContract(contract, normPath(path)) || matchesContract(contract, withVersion);
}

function matchesContract(contract: string[], normalised: string): boolean {
  const p = normalised.split("/");
  return contract.some((c) => {
    const parts = c.split("/");
    return parts.length === p.length && parts.every((s, i) => s === "*" || p[i] === "*" || s === p[i]);
  });
}

/** Backtick spans that read as code and are stated as present (not "missing `x`" / "instead of `y`"). */
function presentCodeQuotes(text: string): string[] {
  const out: string[] = [];
  // Split on backticks so pairs stay in step even around a one-character span like `/`.
  const parts = text.split("`");
  let offset = 0;
  for (let i = 0; i < parts.length; i++) {
    const start = offset;
    offset += parts[i]!.length + 1;
    if (i % 2 === 0 || i === parts.length - 1) continue; // outside a span, or an unclosed last one
    const q = parts[i]!.trim();
    if (q.length < 3 || q.length > 300) continue;
    if (PATH_LIKE.test(q) || /^https?:\/\//i.test(q) || /^(get|post|put|patch|delete)\s/i.test(q) || q.includes("tier3-review-screenshots")) continue;
    // Not a claim about source code: a file or route path, a URL or data containing one, observed output (a JSON body),
    // or shortened code ("...").
    if (!/\s/.test(q) && !/[=(){}<>"';]/.test(q) && (q.includes("/") || q.startsWith("."))) continue;
    if (q.includes("://") || q.includes("...") || q.includes("…")) continue;
    if (/^[{[]\s*"/.test(q) || /^"[^"]*"\s*:/.test(q)) continue; // a response body or a piece of one
    if (/^[A-Za-z_][\w.]*=[^"'`\s(){}<>]*$/.test(q)) continue; // a settings value (PORT=3201), not code
    if (!CODE_CHARS.test(q)) continue;
    // A suggestion or an example, not a claim that the code exists: "use `unnest()`", "e.g. `x = 2`".
    if (SUGGESTION.test(text.slice(Math.max(0, start - 41), start - 1))) continue;
    if (ABSENCE.test(text.slice(Math.max(0, start - 100), start))) continue;
    // A condition, not a claim that the code exists: "even when `role === "staff"`", "if `x > 0`".
    if (CONDITION.test(text.slice(Math.max(0, start - 31), start - 1))) continue;
    out.push(q);
  }
  return out;
}

export function checkFindingProof(text: string, ctx: ProofContext): { ok: true } | { ok: false; reason: string } {
  const negative: string[] = [];
  let positive = false;

  const quotes = presentCodeQuotes(text);
  if (quotes.length > 0 && ctx.files.size > 0) {
    const missing = quotes.filter((q) => {
      const s = squash(q);
      for (const body of ctx.files.values()) if (body.includes(s)) return false;
      return true;
    });
    if (missing.length < quotes.length) positive = true;
    if (missing.length > 0) negative.push(`quotes code that is in no project file: ${missing.map((q) => `\`${q}\``).join(", ")}`);
  }

  const cited = citedFiles(text);
  if (cited.length > 0 && ctx.files.size > 0) {
    const missing = cited.filter((f) => !ctx.files.has(f));
    if (missing.length === cited.length) negative.push(`cites files that do not exist: ${missing.join(", ")}`);
  }

  const paths = apiPaths(text);
  if (paths.length > 0 && ctx.contract) {
    const unknown = paths.filter((p) => !contractHas(ctx.contract!, p) && !ctx.frontendSource.includes(normPath(p).split("/*")[0]!));
    if (unknown.length === paths.length) negative.push(`names API paths that are not in the approved contract and that the app never calls: ${unknown.join(", ")}`);
  }

  if (negative.length > 0 && !positive) return { ok: false, reason: negative.join("; ") };
  return { ok: true };
}

export function dropUnprovenFindings<F extends { file?: string; issue?: string; detail?: string }>(
  findings: F[],
  projectDir: string,
  ctx: ProofContext = buildProofContext(projectDir),
): { kept: F[]; dropped: Array<{ finding: F; reason: string }> } {
  const kept: F[] = [];
  const dropped: Array<{ finding: F; reason: string }> = [];
  for (const f of findings) {
    const text = [f.file ? `\`${f.file}\`` : "", f.issue ?? "", f.detail ?? ""].join(" ");
    const r = checkFindingProof(text, ctx);
    if (r.ok) kept.push(f);
    else dropped.push({ finding: f, reason: r.reason });
  }
  return { kept, dropped };
}

