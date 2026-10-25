// The Chief AI's check before any paid fix (2026-10-24, docs/root-cause/2026-10-24-brewline.md). Of Brewline's 53 findings
// 30% were outside the approved plan and 6% contradicted the code, yet each started a fix round; the Chief AI only looked
// at a finding when a builder disputed it, after the round was already paid for. Now every model-written finding goes
// through ONE call per round that sees the approved plan items, the finding (with the proof gate's flag, see
// finding-proof.ts) and the real code of the files it cites, and answers per finding:
//   fix   — breaks a named plan item and the code shows it; restated with the real code, then routed to a builder
//   later — real but outside the approved plan; written to later.jsonl and handed to the owner with the app
//   false — contradicted by the code; written to settled-not-true.jsonl so a repeat is dropped without a round
// Machine findings (page sweep, colour check, emoji, dead button, sign-in check) are proven by code and skip the call.
// If the call fails, every finding is kept: a real bug is never lost to a failed check.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProofContext, checkFindingProof, citedFiles } from "./finding-proof.ts";
import { limitedRolesFromContract } from "../../agents/riya/src/index.ts";

export interface PlanItem {
  id: string;
  text: string;
}

/** Fixed security baseline every generated app must meet (the generated-stack rules, independent of the spec). */
export const SECURITY_BASELINE: string[] = [
  "SQL uses parameter placeholders, never string-built queries",
  "Every endpoint the contract marks as requiring sign-in rejects requests without a valid token; role-limited endpoints reject other roles",
  "A signed-in user can only read and change their own records",
  "Passwords are hashed; no secret or password is hard-coded, written to a log or console, or kept in a test or example file that ships with the source (the only place a generated password appears is the owner's one-time login file)",
  "User input is never rendered as raw HTML",
  "Sign-in and sign-up are rate limited",
  "CORS allows only the app's own frontend",
  "The names of the tools that built the app, and the internal brief or spec text, never appear to users (page title, description and other metadata, errors, API responses)",
  // 2026-10-25 (brewline2): a sign-up that accepted role: 'staff' from the request was filed as "later" because the spec's own
  // wording allowed a staff sign-up. A plan cannot authorise a vulnerability.
  "No endpoint ever lets the caller choose a role or permissions for themselves (public sign-up creates the lowest role only; staff accounts come from a seeded account or from someone who already has that role)",
];

/** What every app keeps, independent of the spec: history is not changed by editing or deleting what it refers to. */
export const INTEGRITY_BASELINE: string[] = [
  "Deleting or editing a record that history refers to (a menu item, a product, a service) never deletes or changes what past orders, invoices or bookings recorded: their lines stay, with the name and price as they were at the time",
  "A check-then-write (is the item in stock, is the slot free) is one atomic step, so two requests at once cannot both pass it",
  // 2026-10-25 (brewline3): the frontend offered pickup slots from 6:30 and the backend refused anything before 8:00; the spec said
  // "during store hours" and gave no hours, so each side invented its own.
  "A business rule with a number in it (opening hours, minimum notice, order limits) is defined once, from the spec or the plan's stated default, and the frontend and the backend use the same values",
];

const readJson = <T>(file: string): T | null => {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as T) : null;
  } catch {
    return null;
  }
};

export function planItemsFor(projectDir: string): PlanItem[] {
  const items: PlanItem[] = [];
  const spec = readJson<{ successCriteria?: string[] }>(join(projectDir, "spec.json"));
  (spec?.successCriteria ?? []).forEach((c, i) => items.push({ id: `SC${i + 1}`, text: c }));
  const contract = readJson<{ endpoints?: Array<{ method?: string; path?: string; description?: string }> }>(join(projectDir, "api-contract.json"));
  const endpoints = contract?.endpoints ?? [];
  endpoints.forEach((e, i) => items.push({ id: `EP${i + 1}`, text: `${e.method ?? ""} ${e.path ?? ""}${e.description ? ` — ${e.description}` : ""}` }));
  const roles = limitedRolesFromContract(endpoints);
  items.push({ id: "ROLES", text: roles.length > 0 ? `signed-in users, plus these roles: ${roles.join(", ")} (no other role exists)` : "signed-in users only (no other role exists)" });
  const plan = readJson<{ designBrief?: { palette?: Array<{ name?: string; hex?: string }>; typography?: { display?: string; body?: string } } }>(join(projectDir, "build-plan.json"));
  const brief = plan?.designBrief;
  if (brief) {
    const colours = (brief.palette ?? []).map((p) => `${p.name ?? ""} ${p.hex ?? ""}`.trim()).join(", ");
    const fonts = [brief.typography?.display, brief.typography?.body].filter(Boolean).join(" / ");
    items.push({ id: "DESIGN", text: `approved design: colours ${colours || "(none)"}; fonts ${fonts || "(none)"}` });
  }
  SECURITY_BASELINE.forEach((s, i) => items.push({ id: `SEC${i + 1}`, text: s }));
  INTEGRITY_BASELINE.forEach((s, i) => items.push({ id: `INT${i + 1}`, text: s }));
  return items;
}

/** The approved plan as reviewers see it: the yardstick every finding must name. */
export function planSection(projectDir: string): string {
  return planItemsFor(projectDir).map((i) => `[${i.id}] ${i.text}`).join("\n");
}

const MACHINE = /\[(route-sweep|spec-compliance|emoji-ui|auth-smoke|stack-conformance|perf-scan|hygiene)\]|appears to be dead ui|^live design review failed/i;
export function isMachineFinding(text: string): boolean {
  return MACHINE.test(text.replace(/^\|/, "").trim());
}

const REVIEWER_FAILURE = /review-incomplete|review did not complete|could not be parsed as json|^\|?\s*stopped: the step was cancelled|^\|?\s*aborted early:|fallback findings extraction failed|all pool models exhausted/i;
export function isReviewerFailure(text: string): boolean {
  return REVIEWER_FAILURE.test(text.trim());
}

export interface ChiefFinding {
  text: string;
  /** The proof gate's reason, when it found part of the finding false. */
  flag?: string;
}

/** Runs the proof gate over the findings and attaches its reason to those it found part-false. */
export function prepareForChief(projectDir: string, texts: string[]): ChiefFinding[] {
  const ctx = buildProofContext(projectDir);
  return texts.map((text) => {
    const r = checkFindingProof(text, ctx);
    return r.ok ? { text } : { text, flag: r.reason };
  });
}

export type ChiefChat = (prompt: string) => Promise<string>;

// 2026-10-25 (brewline3): files were cut at 8,000 characters, so a finding about line 296 of a long file was judged on its first
// 150 lines, answered "cut off, cannot confirm" and dismissed as not true. A small file is shown whole; a large one as its first
// lines (imports, constants) plus the lines around every line the findings cite, numbered, so the cited place is always there.
const WHOLE_FILE_CHARS = 30_000;
const MAX_CODE_CHARS = 150_000;
const HEAD_LINES = 30;
const WINDOW_LINES = 80;

/** The lines of `rel` that the finding names (`path:LINE`, `path:LINE-LINE`, or `line N` when it cites one file). */
function citedLines(text: string, rel: string, onlyFile: boolean): number[] {
  const out = new Set<number>();
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const m of text.matchAll(new RegExp(`${escaped}:(\\d+)(?:\\s*[-–]\\s*(\\d+))?`, "gi"))) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = a; n <= Math.min(b, a + 200); n++) out.add(n);
  }
  if (onlyFile) for (const m of text.matchAll(/\blines?\s+(\d+)/gi)) out.add(Number(m[1]));
  return [...out];
}

interface Shown {
  text: string;
  whole: boolean;
}

function showFile(body: string, cited: number[]): Shown {
  const lines = body.split("\n");
  const numbered = (from: number, to: number) => lines.slice(from, to).map((l, i) => `${from + i + 1}| ${l}`).join("\n");
  if (body.length <= WHOLE_FILE_CHARS) return { text: numbered(0, lines.length), whole: true };
  const keep = new Set<number>();
  for (let i = 0; i < Math.min(HEAD_LINES, lines.length); i++) keep.add(i);
  for (const n of cited) for (let i = Math.max(0, n - 1 - WINDOW_LINES); i <= Math.min(lines.length - 1, n - 1 + WINDOW_LINES); i++) keep.add(i);
  if (cited.length === 0) for (let i = 0; i < lines.length && [...keep].length * 60 < WHOLE_FILE_CHARS; i++) keep.add(i);
  const parts: string[] = [];
  let prev = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== prev + 1) parts.push(`... (lines ${prev + 2}-${i} not shown)`);
    parts.push(`${i + 1}| ${lines[i]}`);
    prev = i;
  }
  if (prev < lines.length - 1) parts.push(`... (lines ${prev + 2}-${lines.length} not shown)`);
  return { text: parts.join("\n"), whole: false };
}

interface CodeView {
  text: string;
  /** every cited file's full text, whitespace-collapsed, for checking a quote */
  full: Map<string, string>;
  /** files shown in full */
  whole: Set<string>;
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

function codeView(projectDir: string, findings: ChiefFinding[]): CodeView {
  const files = [...new Set(findings.flatMap((f) => citedFiles(f.text)))];
  const parts: string[] = [];
  const view: CodeView = { text: "", full: new Map(), whole: new Set() };
  let used = 0;
  for (const rel of files) {
    const abs = join(projectDir, rel);
    if (!existsSync(abs)) {
      parts.push(`=== ${rel} === (does not exist in the project)`);
      continue;
    }
    let body = "";
    try {
      body = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    view.full.set(rel, collapse(body));
    const cited = findings.flatMap((f) => (citedFiles(f.text).includes(rel) ? citedLines(f.text, rel, citedFiles(f.text).length === 1) : []));
    const shown = showFile(body, cited);
    if (used + shown.text.length > MAX_CODE_CHARS) {
      parts.push(`=== ${rel} === (not included: size limit)`);
      continue;
    }
    used += shown.text.length;
    if (shown.whole) view.whole.add(rel);
    parts.push(`=== ${rel} ===\n${shown.text}`);
  }
  view.text = parts.join("\n\n");
  return view;
}

function codeExcerpts(projectDir: string, findings: ChiefFinding[]): string {
  return codeView(projectDir, findings).text;
}

export function chiefPrompt(projectDir: string, findings: ChiefFinding[]): string {
  const list = findings.map((f, i) => `FINDING ${i + 1}${f.flag ? ` — GATE: ${f.flag}` : ""}\n${f.text}`).join("\n\n");
  return `You are the Chief AI. Before any builder is paid to change code, decide each review finding below using only
the APPROVED PLAN and the REAL CODE shown. Do not add findings. Do not guess: if the code shown does not support a claim,
it is not confirmed.

APPROVED PLAN (the only yardstick):
${planSection(projectDir)}

For each finding answer one of:
- "fix": it breaks a plan item above AND the code shown (or the observation it reports) supports it. Give plan_item
  (e.g. "SC3", "EP2", "SEC6", "DESIGN") and restate it in "text" quoting the REAL code exactly, without any part the
  code contradicts.
- "later": it may be real but breaks no plan item (a role, feature or rule the plan does not have; a nicety). A security
  flaw (a caller choosing their own role, injection, exposed data) or lost history (SEC items, INT1/INT2) is never "later"
  because the plan's own wording allowed it: a plan cannot authorise a vulnerability or the loss of recorded orders; answer
  "fix" with the matching SEC or INT item.
- "false": the code shown contradicts it. You MUST give "quote": the exact code from REAL CODE below that contradicts the
  claim (copied word for word). If a claim says something is missing and the whole file is shown with no such thing, set
  "quote" to "" and "absent": true. If you cannot see the code a finding is about (a part not shown, a file not included),
  that is NOT "false": answer "fix" and say in "reason" that you cannot see it, so a builder confirms it. A GATE note means
  the system already found part of it false; keep only a part you can confirm in the code (as "fix"), otherwise "false".

FINDINGS:
${list}

REAL CODE OF THE FILES THE FINDINGS CITE:
${codeExcerpts(projectDir, findings) || "(no files cited)"}

Answer with ONLY a JSON array, one object per finding:
[{"id": 1, "verdict": "fix" | "later" | "false", "plan_item": "SC1", "text": "...", "quote": "(false only)", "absent": false, "reason": "one line"}]`;
}

interface Verdict {
  id: number;
  verdict: string;
  plan_item?: string;
  text?: string;
  quote?: string;
  absent?: boolean;
  reason?: string;
}

/** A "false" is accepted when the system already proved it (gate flag), the quote is really in a cited file, or the claim is an absence in a file shown whole. */
function falseIsProven(f: ChiefFinding, v: Verdict, view: CodeView): boolean {
  if (f.flag) return true;
  const files = citedFiles(f.text);
  const quote = collapse(String(v.quote ?? ""));
  if (quote.length >= 12) return files.some((rel) => view.full.get(rel)?.includes(quote));
  return v.absent === true && files.length > 0 && files.every((rel) => view.whole.has(rel) || !view.full.has(rel));
}

function parseVerdicts(raw: string): Verdict[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("no JSON array in the Chief AI's answer");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("the Chief AI's answer is not an array");
  return parsed as Verdict[];
}

export interface ChiefResult {
  fix: Array<{ text: string; original: string }>;
  later: Array<{ text: string; reason: string }>;
  notTrue: Array<{ text: string; reason: string }>;
  /** false when the call failed and everything was kept */
  checked: boolean;
}

export async function chiefCheck(projectDir: string, findings: ChiefFinding[], chat: ChiefChat): Promise<ChiefResult> {
  const keepAll = (): ChiefResult => ({ fix: findings.map((f) => ({ text: f.text, original: f.text })), later: [], notTrue: [], checked: false });
  if (findings.length === 0) return { fix: [], later: [], notTrue: [], checked: true };
  let verdicts: Verdict[];
  const view = codeView(projectDir, findings);
  try {
    verdicts = parseVerdicts(await chat(chiefPrompt(projectDir, findings)));
  } catch (err) {
    console.warn(`[chief-check] the check failed, every finding is kept: ${String(err).slice(0, 200)}`);
    return keepAll();
  }
  const ids = new Set(planItemsFor(projectDir).map((i) => i.id));
  const out: ChiefResult = { fix: [], later: [], notTrue: [], checked: true };
  const now = new Date().toISOString();
  findings.forEach((f, i) => {
    const v = verdicts.find((x) => Number(x.id) === i + 1);
    if (!v) {
      out.fix.push({ text: f.text, original: f.text }); // unanswered: kept, never lost
      return;
    }
    const verdict = String(v.verdict).toLowerCase();
    const item = String(v.plan_item ?? "").toUpperCase();
    if (verdict === "false" && !falseIsProven(f, v, view)) {
      // 2026-10-25: "cannot see" or "no quote" is not "not true": the finding stays and a builder confirms it against the real code.
      console.log(`[chief-check] ruled false without proof (no quote found in the cited file), kept for a builder to confirm: ${f.text.slice(0, 140)}`);
      out.fix.push({ text: f.text, original: f.text });
    } else if (verdict === "false") {
      out.notTrue.push({ text: f.text, reason: v.reason ?? "" });
      appendFileSync(join(projectDir, "settled-not-true.jsonl"), JSON.stringify({ finding: f.text, evidence: `Chief AI check: ${v.reason ?? ""}`, at: now }) + "\n");
      console.log(`[chief-check] not true, not fixed: ${f.text.slice(0, 140)} — ${String(v.reason ?? "").slice(0, 160)}`);
    } else if (verdict === "fix" && ids.has(item)) {
      const text = String(v.text ?? "").trim() || f.text;
      out.fix.push({ text: `[${item}] ${text.replace(/^\[[A-Z]+\d*\]\s*/, "")}`, original: f.text });
    } else {
      out.later.push({ text: f.text, reason: v.reason ?? (verdict === "fix" ? `names no plan item (${item || "none"})` : "") });
      appendFileSync(join(projectDir, "later.jsonl"), JSON.stringify({ finding: f.text, reason: v.reason ?? "", at: now }) + "\n");
      console.log(`[chief-check] outside the approved plan, kept for later: ${f.text.slice(0, 140)}`);
    }
  });
  return out;
}

/** The real model call: one plain chat on the strongest tier, no tools. */
export const defaultChiefChat: ChiefChat = async (prompt) => {
  const { routeWithFallback, withCallContext } = await import("@nexsidi/llm-client");
  // 2026-10-25: the call ledger records this call as the Chief AI's, inside whichever project's activity made it.
  const r = await withCallContext({ agent: "chief-ai", tier: "critical" }, () => routeWithFallback("critical", [{ role: "user", content: prompt }], { maxTokens: 8_000 }));
  return r.content;
};
