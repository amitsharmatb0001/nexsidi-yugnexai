// Replay real saved agent histories through context compaction and measure
// what survives (triage compaction plan, docs/nexsidi/plans/2026-09-26-
// triage-compaction.md, Task 3). Measure first, change behavior second.
//
//   bun scripts/compaction-replay.ts [--triage] [--files "<dir>/*/history-*.json"] [--out <path>] [--no-db]
//
// Sources: every row of agent_conversations (read-only SELECT via
// DATABASE_URL) plus any --files. De-duplicated by content hash, since many
// build dirs hold byte-identical copies of the same history. Only
// Gemini-shaped histories over the live 120K compaction threshold are
// replayed, because that is the only path that compacts in practice.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { GeminiMessage, GeminiPart } from "@nexsidi/llm-client";
import { compactViaRelevantContext, type FactLedgerEntry, type SelectContextOptions } from "../packages/agent-runtime/src/context-selection.ts";
import { estimateGeminiTokenCount } from "../packages/agent-runtime/src/compaction.ts";
import { findGeminiPairingViolations } from "../packages/agent-runtime/src/history-validate.ts";
import { collectCalls } from "../packages/agent-runtime/src/triage-compaction.ts";

export interface CompactionMetrics {
  tokensBefore: number;
  tokensAfter: number;
  pairingViolations: string[];
  callsBefore: number; // functionCall parts in the input
  callsWithFullResultAfter: number; // calls whose original result survives unchanged
  unresolvedErrorsBefore: number; // status:"error" results with no later success on the same target
  unresolvedErrorsKept: number;
  latestResultsBefore: number; // newest successful copy of each distinct call (name + args)
  latestResultsKept: number; // ...whose result survives, verbatim or capped (not stubbed/dropped)
}

interface ReplayCall {
  name: string;
  argsKey: string;
  target: string | null;
  responseJson: string;
  isError: boolean;
}

// Same call/response pairing and target rules as the triage pass itself.
function callsOf(messages: GeminiMessage[]): ReplayCall[] {
  return collectCalls(messages).map((c) => {
    const part = (messages[c.responseTurn]!.content as GeminiPart[])[c.responsePart] as { functionResponse: { response: unknown } };
    return { name: c.name, argsKey: c.argsKey, target: c.target, responseJson: JSON.stringify(part.functionResponse.response), isError: c.isError };
  });
}

// A kept result may have been capped (4,000 chars per string) rather than
// stubbed or dropped. Match on the call's identity in `after`, then require
// that its result is not a compaction stub.
function survivingSignatures(after: GeminiMessage[]): Set<string> {
  const set = new Set<string>();
  for (const c of collectCalls(after)) {
    const part = (after[c.responseTurn]!.content as GeminiPart[])[c.responsePart] as { functionResponse: { response: Record<string, unknown> } };
    if (part.functionResponse.response?.compacted !== true) set.add(`${c.name}\u0000${c.argsKey}`);
  }
  return set;
}

function responseJsonsOf(messages: GeminiMessage[]): Set<string> {
  const set = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content) if ("functionResponse" in p) set.add(JSON.stringify(p.functionResponse.response));
  }
  return set;
}

export function measureCompaction(before: GeminiMessage[], after: GeminiMessage[]): CompactionMetrics {
  const calls = callsOf(before);
  const kept = responseJsonsOf(after);

  const unresolved: ReplayCall[] = [];
  const succeededLater = new Set<string>();
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]!;
    const key = c.target === null ? null : `${c.name}\u0000${c.target}`;
    if (c.isError && !(key && succeededLater.has(key))) unresolved.push(c);
    if (!c.isError && key) succeededLater.add(key);
  }

  const latest = new Set<string>();
  for (const c of calls) if (!c.isError) latest.add(`${c.name}\u0000${c.argsKey}`);
  const surviving = survivingSignatures(after);

  return {
    tokensBefore: estimateGeminiTokenCount(before),
    tokensAfter: estimateGeminiTokenCount(after),
    pairingViolations: findGeminiPairingViolations(after),
    callsBefore: calls.length,
    callsWithFullResultAfter: calls.filter((c) => kept.has(c.responseJson)).length,
    unresolvedErrorsBefore: unresolved.length,
    unresolvedErrorsKept: unresolved.filter((c) => kept.has(c.responseJson) || surviving.has(`${c.name}\u0000${c.argsKey}`)).length,
    latestResultsBefore: latest.size,
    latestResultsKept: [...latest].filter((s) => surviving.has(s)).length,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────

const THRESHOLD_TOKENS = 120_000; // gemini-loop.ts COMPACTION_THRESHOLD_TOKENS

interface Source {
  label: string;
  messages: GeminiMessage[];
  factLedger: FactLedgerEntry[];
}

function isGeminiShaped(messages: unknown): messages is GeminiMessage[] {
  return Array.isArray(messages) && messages.some((m) => (m as { role?: string }).role === "model");
}

async function loadDbSources(): Promise<Source[]> {
  if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL not set; skipping the database");
    return [];
  }
  // Imported lazily: the db client throws at import time without DATABASE_URL.
  const { db } = await import("../packages/db/src/index.ts");
  const { agentConversations } = await import("../packages/db/src/schema.ts");
  const rows = await db.select().from(agentConversations); // read-only
  return rows.map((r) => ({
    label: `db:${r.projectId}/${r.agentName}`,
    messages: r.messages as GeminiMessage[],
    factLedger: Array.isArray(r.factLedger) ? (r.factLedger as FactLedgerEntry[]) : [],
  }));
}

async function loadFileSources(pattern: string): Promise<Source[]> {
  const normalized = pattern.replace(/\\/g, "/");
  const firstGlob = normalized.search(/[*?[{]/);
  const cut = normalized.lastIndexOf("/", firstGlob);
  const base = normalized.slice(0, cut);
  const glob = new Bun.Glob(normalized.slice(cut + 1));
  const out: Source[] = [];
  for await (const rel of glob.scan({ cwd: base })) {
    const path = `${base}/${rel.replace(/\\/g, "/")}`;
    try {
      out.push({ label: `file:${path}`, messages: JSON.parse(readFileSync(path, "utf-8")), factLedger: [] });
    } catch (err) {
      console.warn(`skipping unreadable ${path}: ${String(err).slice(0, 120)}`);
    }
  }
  return out;
}

function firstUserText(messages: GeminiMessage[]): string {
  const m = messages.find((x) => x.role === "user" && typeof x.content === "string");
  return m && typeof m.content === "string" ? m.content : "";
}

async function main(argv: string[]): Promise<void> {
  const arg = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const files = arg("--files");
  const outPath = arg("--out");
  const withTriage = argv.includes("--triage");

  const sources = [...(argv.includes("--no-db") ? [] : await loadDbSources()), ...(files ? await loadFileSources(files) : [])];

  const seen = new Set<string>();
  type Measured = { ms: number } & CompactionMetrics;
  const results: Array<{ label: string; triage?: Measured } & Measured> = [];
  let skippedSmall = 0;
  let skippedShape = 0;
  let duplicates = 0;
  for (const s of sources) {
    const hash = createHash("sha256").update(JSON.stringify(s.messages)).digest("hex");
    if (seen.has(hash)) { duplicates++; continue; }
    seen.add(hash);
    if (!isGeminiShaped(s.messages)) { skippedShape++; continue; }
    if (estimateGeminiTokenCount(s.messages) < THRESHOLD_TOKENS) { skippedSmall++; continue; }

    const task = firstUserText(s.messages);
    const run = (options: SelectContextOptions): Measured => {
      const started = performance.now();
      const after = compactViaRelevantContext(s.messages, task, s.factLedger, THRESHOLD_TOKENS, options);
      const ms = Math.round(performance.now() - started);
      return { ms, ...measureCompaction(s.messages, after) };
    };
    results.push({ label: s.label, ...run({}), ...(withTriage ? { triage: run(TRIAGE_OPTIONS) } : {}) });
  }

  const totalsOf = (rows: Measured[]) => {
    const sum = (f: (r: Measured) => number) => rows.reduce((n, r) => n + f(r), 0);
    return {
      avgTokensAfter: rows.length ? Math.round(sum((r) => r.tokensAfter) / rows.length) : 0,
      maxTokensAfter: rows.reduce((n, r) => Math.max(n, r.tokensAfter), 0),
      historiesWithPairingViolations: rows.filter((r) => r.pairingViolations.length > 0).length,
      callsWithFullResultAfter: sum((r) => r.callsWithFullResultAfter),
      unresolvedErrorsKept: sum((r) => r.unresolvedErrorsKept),
      latestResultsKept: sum((r) => r.latestResultsKept),
      maxMs: rows.reduce((n, r) => Math.max(n, r.ms), 0),
    };
  };
  const totals = {
    sources: sources.length,
    duplicates,
    skippedNotGemini: skippedShape,
    skippedUnderThreshold: skippedSmall,
    replayed: results.length,
    avgTokensBefore: results.length ? Math.round(results.reduce((n, r) => n + r.tokensBefore, 0) / results.length) : 0,
    callsBefore: results.reduce((n, r) => n + r.callsBefore, 0),
    unresolvedErrorsBefore: results.reduce((n, r) => n + r.unresolvedErrorsBefore, 0),
    latestResultsBefore: results.reduce((n, r) => n + r.latestResultsBefore, 0),
    current: totalsOf(results),
    ...(withTriage ? { triage: totalsOf(results.map((r) => r.triage!)) } : {}),
  };

  console.table(results.map((r) => ({
    history: r.label.length > 52 ? `…${r.label.slice(-51)}` : r.label,
    tokens: `${r.tokensBefore} → ${r.tokensAfter}${r.triage ? ` | ${r.triage.tokensAfter}` : ""}`,
    latestKept: `${r.latestResultsKept}${r.triage ? ` | ${r.triage.latestResultsKept}` : ""} /${r.latestResultsBefore}`,
    unresolvedErrors: `${r.unresolvedErrorsKept}${r.triage ? ` | ${r.triage.unresolvedErrorsKept}` : ""} /${r.unresolvedErrorsBefore}`,
    pairingOk: r.pairingViolations.length === 0 && (r.triage?.pairingViolations.length ?? 0) === 0,
    ms: `${r.ms}${r.triage ? ` | ${r.triage.ms}` : ""}`,
  })));
  console.log(JSON.stringify(totals, null, 2));
  if (outPath) writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), totals, results }, null, 2));
}

// Same values gemini-loop.ts passes when TRIAGE_COMPACTION_ENABLED=true.
const TRIAGE_OPTIONS: SelectContextOptions = { triageMiddle: { maxMiddleTokens: 40_000, targetTotalTokens: 60_000 } };

if (import.meta.main) {
  await main(process.argv.slice(2));
  process.exit(0);
}
