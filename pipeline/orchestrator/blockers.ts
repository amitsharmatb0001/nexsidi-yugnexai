// Blockers stop paid work, and each one is decided from facts (2026-10-30). Amit: "the owner can't do the edit, then what
// were you doing — why did nobody flag it". Brewline 3 recorded 13 blocker reports; none stopped a round, because only the
// final live review read them. The backend builder could not change db/migrations (twice), a check demanded the deletion
// of a compose file that the ownership rule refused (four times), and the rounds went on.
// Now an open report stops the step (activities: assertNoOpenBlocker) and is decided here, facts first:
//   - the paths it names, and who owns them (backend/ → backend builder, frontend/ → frontend builder, db/ → database
//     builder; a bare file name is in the reporting builder's own folder);
//   - whether one of our own tools refused the action, and whether one of our own checks demands that same thing.
// From those facts alone: a system check that demands what the system refuses goes to a person, quoting both (no builder
// can do both); the named owner of the named file fixes it at once. Anything else goes to the Chief AI, whose decision
// counts only with proof — a quote that is really in the file, a file that is really in the owner's folder — or the build
// holds for a person. A report that comes back after its decision is not decided again: it goes to a person.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blockerId, openBlockers, readBlockerRulings, recordBlockerRuling, type BlockedReport } from "../../packages/agent-runtime/src/tools/blocked.ts";
import { recordCodeAnswer, recordCustomerQuestion } from "../../packages/agent-runtime/src/tools/ask.ts";
import { toCustomerText } from "../../packages/agent-runtime/src/customer-text.ts";
import { buildDirFor } from "../../packages/agent-runtime/src/build-dir.ts";
import { planSection, type ChiefChat } from "./chief-check.ts";

export type Owner = "shubham" | "aanya" | "pranav";
const FOLDER_OF: Record<Owner, string> = { shubham: "backend", aanya: "frontend", pranav: "db" };
const OWNER_OF: Record<string, Owner> = { backend: "shubham", frontend: "aanya", db: "pranav" };
const isOwner = (o: string): o is Owner => o in FOLDER_OF;

export type BlockerDecision =
  | { kind: "route"; owner: Owner; change: string }
  | { kind: "answer"; answer: string; quote: string; file: string }
  | { kind: "customer"; forCustomer: string }
  | { kind: "person"; reason: string };

export interface BlockerFacts {
  /** project paths the report names */
  paths: string[];
  /** owners of those paths */
  owners: Owner[];
  /** one of our own tools' refusal, as the report quotes it */
  refusal: string | null;
  /** which kind: not their file, not available in this run, outside their folder, not on the command list, or refused */
  refusalKind: RefusalKind | null;
  /** an open finding of our own checks that names the same path */
  systemDemand: string | null;
}

// Our own tools' refusal words (ownership.ts, tools/file.ts, tools/command.ts, the loops' blocked-action stop), by kind.
// 2026-10-30 (proof on Brewline 3): without the kind, a refused shell command and a refused read of the column name were
// taken for the same problem as other reports; "were blocked/refused" and "not owned by" were not recognised at all.
export type RefusalKind = "not-yours" | "not-available" | "outside" | "allowlist" | "refused";
const REFUSALS: Array<[RefusalKind, RegExp]> = [
  ["not-yours", /is not one of your files[^'"\n]*|not owned by [^'"\n.]*|locked by [^'"\n.;)]*/i],
  ["not-available", /is not available in this run[^'"\n]*/i],
  ["outside", /path traversal blocked[^'"\n]*|escapes (?:the )?sandbox[^'"\n]*|\d+ actions were refused[^'"\n.]*/i],
  ["allowlist", /failed (?:the )?allowlist check[^'"\n]*|not on the (?:command )?allow ?list[^'"\n]*/i],
  ["refused", /\b(?:were|was) (?:blocked\/refused|blocked|refused)\b[^'"\n]*|permission denied[^'"\n]*|not allowed[^'"\n]*/i],
];
// Names of technologies that look like files ("Node.js").
const TECH_NAMES = /^(node|next|nuxt|vue|react|express|three|chart|d3|moment|lodash|ember|backbone|angular)\.js$/i;
const PREFIXED = /\b(?:backend|frontend|db)\/[\w./()[\]@-]*[\w)\]]/g;
const BARE = /(?<![\w/.-])[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|sql|ya?ml|json|css|env)\b|(?<![\w/.-])\.env(?:\.[a-z]+)?\b/g;

/** What the report names and what our own tools and checks say about it. No model. */
export function blockerFacts(b: BlockedReport, systemFindings: string[]): BlockerFacts {
  const text = `${b.what}\n${b.checked}`;
  const prefixed = [...new Set(text.match(PREFIXED) ?? [])].map((p) => p.replace(/[.)]+$/, ""));
  // A bare file name is the reporting builder's own folder (its tools work there).
  const rest = prefixed.reduce((t, p) => t.split(p).join(" "), text);
  const own = isOwner(b.agent) ? FOLDER_OF[b.agent] : null;
  const bare = own ? [...new Set(rest.match(BARE) ?? [])].filter((f) => !TECH_NAMES.test(f)).map((f) => `${own}/${f}`) : [];
  const all = [...new Set([...prefixed, ...bare])];
  // "db/migrations" is part of "db/migrations/0000_initial.sql": the longer path says more.
  const paths = all.filter((p) => !all.some((q) => q !== p && q.startsWith(`${p}/`)));
  const owners = [...new Set(paths.map((p) => OWNER_OF[p.split("/")[0]!]).filter((o): o is Owner => !!o))];
  // The tool's own words, in what the builder checked, before the builder's description of it.
  const find = (t: string) => REFUSALS.map(([kind, r]) => ({ kind, text: t.match(r)?.[0]?.trim() })).find((x) => x.text);
  const hit = find(b.checked) ?? find(b.what);
  const refusal = hit?.text ?? null;
  const refusalKind = hit?.kind ?? null;
  const lower = paths.map((p) => p.toLowerCase());
  const systemDemand = systemFindings.find((f) => lower.some((p) => f.toLowerCase().includes(p))) ?? null;
  return { paths, owners, refusal, refusalKind, systemDemand };
}

/** Decided by the facts alone, or null when they do not decide it. */
export function ruleByFacts(b: BlockedReport, facts: BlockerFacts): BlockerDecision | null {
  if (facts.refusal && facts.systemDemand) {
    return {
      kind: "person",
      reason: `a system check demands "${facts.systemDemand.slice(0, 300)}" and the system refuses it ("${facts.refusal}"). No builder can do both: the system must change, and a person decides.`,
    };
  }
  // Only a change no tool refused is someone else's change: a refused action is a question about the system (Chief AI).
  if (!facts.refusal && isOwner(b.owner) && facts.owners.includes(b.owner)) return { kind: "route", owner: b.owner, change: b.what };
  return null;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function chiefPrompt(projectDir: string, b: BlockedReport, facts: BlockerFacts): string {
  let plan = "";
  try {
    plan = planSection(projectDir);
  } catch {
    plan = "(not available)";
  }
  return `You are the Chief AI. A builder reports that it cannot do part of its work. Decide from the facts and the project's
own files; never guess. Reply with ONE JSON object:
- {"kind": "route", "owner": "shubham"|"aanya"|"pranav", "change": "what that owner must change", "file": "the file, in that owner's folder (backend/, frontend/ or db/)"} — the change belongs to another builder's folder;
- {"kind": "answer", "answer": "the fact the builder needs", "quote": "the exact text from the file that shows it", "file": "the project file"} — the answer is already in the project's files;
- {"kind": "customer", "forCustomer": "the question in plain words"} — only the customer can say (a business rule or value);
- {"kind": "person", "reason": "why"} — the system itself stops it (a tool or rule no builder can change), or the facts do not decide it.

THE REPORT: from ${b.agent}, naming ${b.owner} as the owner.
What it needs: ${b.what}
What it checked: ${b.checked}

THE FACTS (from the files and our own tools, no model): paths ${facts.paths.join(", ") || "(none named)"}; owners of those paths ${facts.owners.join(", ") || "(none)"}; refused by our own tool: ${facts.refusal ?? "no"}; demanded by our own check: ${facts.systemDemand ?? "no"}.

THE APPROVED PLAN:
${plan}`;
}

/** The Chief AI's decision, accepted only with proof; otherwise a person decides. */
export async function ruleByChief(projectDir: string, b: BlockedReport, facts: BlockerFacts, chat: ChiefChat): Promise<BlockerDecision> {
  let raw = "";
  try {
    raw = await chat(chiefPrompt(projectDir, b, facts));
  } catch (err) {
    return { kind: "person", reason: `the Chief AI could not be asked: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` };
  }
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "") as Record<string, unknown>;
  } catch {
    return { kind: "person", reason: "the Chief AI gave no decision the system can check" };
  }
  const str = (k: string) => String(d[k] ?? "").trim();
  switch (str("kind")) {
    case "route": {
      const owner = str("owner");
      const file = str("file").replace(/\\/g, "/");
      if (!isOwner(owner)) return { kind: "person", reason: `"${owner}" is not a builder` };
      if (!str("change")) return { kind: "person", reason: "the Chief AI routed it without saying what must change" };
      if (!file.startsWith(`${FOLDER_OF[owner]}/`)) return { kind: "person", reason: `the file "${file}" is not in ${owner}'s folder (${FOLDER_OF[owner]}/), so ${owner} cannot change it` };
      return { kind: "route", owner, change: `${str("change")} (in ${file})` };
    }
    case "answer": {
      const file = str("file").replace(/\\/g, "/");
      const quote = squash(str("quote"));
      const abs = join(projectDir, file);
      const body = file && existsSync(abs) ? squash(readFileSync(abs, "utf-8")) : "";
      if (!str("answer") || quote.length < 8 || !body.includes(quote)) return { kind: "person", reason: `the Chief AI's answer quotes text that is not in ${file || "(no file)"}` };
      return { kind: "answer", answer: str("answer"), quote, file };
    }
    case "customer":
      return str("forCustomer") ? { kind: "customer", forCustomer: toCustomerText(str("forCustomer")) } : { kind: "person", reason: "no question for the customer was given" };
    case "person":
      return { kind: "person", reason: str("reason") || "the Chief AI says a person must decide" };
    default:
      return { kind: "person", reason: "the Chief AI gave no decision the system can check" };
  }
}

/** The facts a decision stands on: who reported, which paths (or which owner), and whether our own tool refused. */
export function factsKey(b: BlockedReport, facts: BlockerFacts): string {
  return `${b.agent}|${facts.paths.join(",") || b.owner}|${facts.refusalKind ?? ""}`;
}

/**
 * Two reports stand on the same facts when the same builder reports the same kind of refusal (or none) about the same
 * place: the same paths, or a file inside a folder the other names (Brewline 3: "db/migrations" and
 * "db/migrations/0000_initial.sql"). With no paths, the owner they name stands for the place.
 */
export function sameFacts(a: string, b: string): boolean {
  const [agentA, placeA = "", kindA = ""] = a.split("|");
  const [agentB, placeB = "", kindB = ""] = b.split("|");
  if (agentA !== agentB || kindA !== kindB) return false;
  if (placeA === placeB) return true;
  const pa = placeA.split(",");
  const pb = placeB.split(",");
  const inside = (x: string, y: string) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
  return pa.every((x) => pb.some((y) => inside(x, y))) && pb.every((y) => pa.some((x) => inside(x, y)));
}

const ROLE: Record<string, string> = { shubham: "backend", aanya: "frontend", pranav: "database" };

export interface BlockerDeps {
  chat?: ChiefChat;
  /** the owner's fix run, at once */
  fix(owner: Owner, findings: string[]): Promise<{ success: boolean; filesWritten?: string[] }>;
  /** the open findings of the system's own checks (hygiene, finish checks) */
  systemFindings(): string[];
}

export async function resolveBlockers(projectId: string, deps: BlockerDeps): Promise<{ routed: number; answered: number; customer: number; person: Array<{ agent: string; what: string; reason: string }> }> {
  const dir = buildDirFor(projectId);
  const out = { routed: 0, answered: 0, customer: 0, person: [] as Array<{ agent: string; what: string; reason: string }> };
  const decided = readBlockerRulings(projectId);
  const thisPass: Array<{ key: string; decision: BlockerDecision }> = [];
  const chat = deps.chat ?? (await import("./chief-check.ts")).defaultChiefChat;
  for (const b of openBlockers(projectId)) {
    const facts = blockerFacts(b, deps.systemFindings());
    const key = factsKey(b, facts);
    let decision: BlockerDecision;
    let detail = "";
    const twin = thisPass.find((t) => sameFacts(t.key, key));
    if (twin) {
      // The same report twice before any decision (Brewline 3: 11:20 and 11:24): one decision, one action.
      decision = twin.decision;
      recordBlockerRuling(projectId, { id: blockerId(b), agent: b.agent, kind: decision.kind, detail: "the same as an earlier report in this pass", factsKey: key, at: new Date().toISOString() });
      continue;
    }
    const before = decided.find((r) => sameFacts(r.factsKey, key));
    if (before) {
      decision = { kind: "person", reason: `it came back after it was decided (${before.kind}: ${before.detail.slice(0, 200)}), so that decision did not resolve it` };
    } else {
      decision = ruleByFacts(b, facts) ?? (await ruleByChief(dir, b, facts, chat));
    }
    thisPass.push({ key, decision });
    switch (decision.kind) {
      case "route": {
        const r = await deps.fix(decision.owner, [
          `Handed to you because the ${ROLE[b.agent] ?? b.agent} builder could not do it (it is in your folder): ${decision.change}\nWhat it checked: ${b.checked}`,
        ]);
        out.routed++;
        detail = `${decision.owner}: ${decision.change.slice(0, 200)} — fix run ${r.success ? "finished" : "did not finish"}`;
        break;
      }
      case "answer":
        recordCodeAnswer(projectId, { question: b.what, answer: decision.answer, quote: decision.quote, askedBy: b.agent });
        out.answered++;
        detail = `${decision.answer} (${decision.file}: "${decision.quote.slice(0, 120)}")`;
        break;
      case "customer":
        recordCustomerQuestion(projectId, { question: b.what, forCustomer: decision.forCustomer, askedBy: b.agent });
        out.customer++;
        detail = decision.forCustomer;
        break;
      case "person":
        out.person.push({ agent: b.agent, what: b.what, reason: decision.reason });
        detail = decision.reason;
        break;
    }
    recordBlockerRuling(projectId, { id: blockerId(b), agent: b.agent, kind: decision.kind, detail, factsKey: key, at: new Date().toISOString() });
    console.log(`[blockers] ${b.agent}: ${b.what.slice(0, 120)} → ${decision.kind}: ${detail.slice(0, 200)}`);
  }
  return out;
}
