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
  "Passwords are hashed; no secret or password is hard-coded",
  "User input is never rendered as raw HTML",
  "Sign-in and sign-up are rate limited",
  "CORS allows only the app's own frontend",
  "The names of the tools that built the app never appear to users",
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
  return items;
}

/** The approved plan as reviewers see it: the yardstick every finding must name. */
export function planSection(projectDir: string): string {
  return planItemsFor(projectDir).map((i) => `[${i.id}] ${i.text}`).join("\n");
}

const MACHINE = /\[(route-sweep|spec-compliance|emoji-ui|auth-smoke|stack-conformance|perf-scan)\]|appears to be dead ui|^live design review failed/i;
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

const MAX_FILE_CHARS = 8_000;
const MAX_CODE_CHARS = 48_000;

function codeExcerpts(projectDir: string, findings: ChiefFinding[]): string {
  const files = [...new Set(findings.flatMap((f) => citedFiles(f.text)))];
  const parts: string[] = [];
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
    if (body.length > MAX_FILE_CHARS) body = body.slice(0, MAX_FILE_CHARS) + "\n... (cut)";
    if (used + body.length > MAX_CODE_CHARS) {
      parts.push(`=== ${rel} === (not included: size limit)`);
      continue;
    }
    used += body.length;
    parts.push(`=== ${rel} ===\n${body}`);
  }
  return parts.join("\n\n");
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
- "later": it may be real but breaks no plan item (a role, feature or rule the plan does not have; a nicety).
- "false": the code shown contradicts it. A GATE note means the system already found part of it false; keep only a
  part you can confirm in the code (as "fix"), otherwise answer "false".

FINDINGS:
${list}

REAL CODE OF THE FILES THE FINDINGS CITE:
${codeExcerpts(projectDir, findings) || "(no files cited)"}

Answer with ONLY a JSON array, one object per finding:
[{"id": 1, "verdict": "fix" | "later" | "false", "plan_item": "SC1", "text": "...", "reason": "one line"}]`;
}

interface Verdict {
  id: number;
  verdict: string;
  plan_item?: string;
  text?: string;
  reason?: string;
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
    if (verdict === "false") {
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
  const { routeWithFallback } = await import("@nexsidi/llm-client");
  const r = await routeWithFallback("critical", [{ role: "user", content: prompt }], { maxTokens: 8_000 });
  return r.content;
};
