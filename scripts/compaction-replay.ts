// Replay real saved agent histories through context compaction and measure
// what survives (triage compaction plan, docs/nexsidi/plans/2026-09-26-
// triage-compaction.md, Task 3). Measure first, change behavior second.
//
//   bun scripts/compaction-replay.ts [--files "<dir>/*/history-*.json"] [--out <path>] [--no-db]
//
// Sources: every row of agent_conversations (read-only SELECT via
// DATABASE_URL) plus any --files. De-duplicated by content hash, since many
// build dirs hold byte-identical copies of the same history. Only
// Gemini-shaped histories over the live 120K compaction threshold are
// replayed, because that is the only path that compacts in practice.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { GeminiMessage } from "@nexsidi/llm-client";
import { compactViaRelevantContext, type FactLedgerEntry } from "../packages/agent-runtime/src/context-selection.ts";
import { estimateGeminiTokenCount } from "../packages/agent-runtime/src/compaction.ts";
import { findGeminiPairingViolations } from "../packages/agent-runtime/src/history-validate.ts";

export interface CompactionMetrics {
  tokensBefore: number;
  tokensAfter: number;
  pairingViolations: string[];
  callsBefore: number; // functionCall parts in the input
  callsWithFullResultAfter: number; // calls whose original result survives unchanged
  unresolvedErrorsBefore: number; // status:"error" results with no later success on the same target
  unresolvedErrorsKept: number;
}

interface ReplayCall {
  name: string;
  target: string | null;
  responseJson: string;
  isError: boolean;
}

// What a call acts on, for "was this error later resolved?". Same rules as
// the triage rules' targetOf (Task 4) — kept local here until then.
function targetOf(name: string, args: Record<string, unknown>): string | null {
  if (typeof args.path === "string") return args.path;
  if (typeof args.command === "string") return args.command;
  if (typeof args.url === "string") return `${String(args.method ?? "GET")} ${args.url}`;
  if (name === "docker_compose" && typeof args.action === "string") return `docker ${args.action} ${String(args.service ?? "all")}`;
  return null;
}

// Pairs each model turn's functionCall parts (in order) with the next turn's
// functionResponse parts.
function callsOf(messages: GeminiMessage[]): ReplayCall[] {
  const calls: ReplayCall[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "model" || !Array.isArray(m.content)) return;
    const next = messages[i + 1];
    const responses = next && Array.isArray(next.content) ? next.content.filter((p) => "functionResponse" in p) : [];
    let r = 0;
    for (const part of m.content) {
      if (!("functionCall" in part)) continue;
      const resp = responses[r++];
      if (!resp || !("functionResponse" in resp)) continue;
      const response = resp.functionResponse.response;
      calls.push({
        name: part.functionCall.name,
        target: targetOf(part.functionCall.name, part.functionCall.args ?? {}),
        responseJson: JSON.stringify(response),
        isError: (response as { status?: unknown }).status === "error",
      });
    }
  });
  return calls;
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

  return {
    tokensBefore: estimateGeminiTokenCount(before),
    tokensAfter: estimateGeminiTokenCount(after),
    pairingViolations: findGeminiPairingViolations(after),
    callsBefore: calls.length,
    callsWithFullResultAfter: calls.filter((c) => kept.has(c.responseJson)).length,
    unresolvedErrorsBefore: unresolved.length,
    unresolvedErrorsKept: unresolved.filter((c) => kept.has(c.responseJson)).length,
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

  const sources = [...(argv.includes("--no-db") ? [] : await loadDbSources()), ...(files ? await loadFileSources(files) : [])];

  const seen = new Set<string>();
  const results: Array<{ label: string; ms: number } & CompactionMetrics> = [];
  let skippedSmall = 0;
  let skippedShape = 0;
  let duplicates = 0;
  for (const s of sources) {
    const hash = createHash("sha256").update(JSON.stringify(s.messages)).digest("hex");
    if (seen.has(hash)) { duplicates++; continue; }
    seen.add(hash);
    if (!isGeminiShaped(s.messages)) { skippedShape++; continue; }
    if (estimateGeminiTokenCount(s.messages) < THRESHOLD_TOKENS) { skippedSmall++; continue; }

    const started = performance.now();
    const after = compactViaRelevantContext(s.messages, firstUserText(s.messages), s.factLedger, THRESHOLD_TOKENS);
    const ms = Math.round(performance.now() - started);
    results.push({ label: s.label, ms, ...measureCompaction(s.messages, after) });
  }

  const sum = (f: (r: CompactionMetrics) => number) => results.reduce((n, r) => n + f(r), 0);
  const totals = {
    sources: sources.length,
    duplicates,
    skippedNotGemini: skippedShape,
    skippedUnderThreshold: skippedSmall,
    replayed: results.length,
    avgTokensBefore: results.length ? Math.round(sum((r) => r.tokensBefore) / results.length) : 0,
    avgTokensAfter: results.length ? Math.round(sum((r) => r.tokensAfter) / results.length) : 0,
    historiesWithPairingViolations: results.filter((r) => r.pairingViolations.length > 0).length,
    callsBefore: sum((r) => r.callsBefore),
    callsWithFullResultAfter: sum((r) => r.callsWithFullResultAfter),
    unresolvedErrorsBefore: sum((r) => r.unresolvedErrorsBefore),
    unresolvedErrorsKept: sum((r) => r.unresolvedErrorsKept),
    maxMs: results.reduce((n, r) => Math.max(n, r.ms), 0),
  };

  console.table(results.map((r) => ({
    history: r.label.length > 60 ? `…${r.label.slice(-59)}` : r.label,
    tokens: `${r.tokensBefore} → ${r.tokensAfter}`,
    results: `${r.callsWithFullResultAfter}/${r.callsBefore}`,
    unresolvedErrors: `${r.unresolvedErrorsKept}/${r.unresolvedErrorsBefore}`,
    pairingOk: r.pairingViolations.length === 0,
    ms: r.ms,
  })));
  console.log(JSON.stringify(totals, null, 2));
  if (outPath) writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), totals, results }, null, 2));
}

if (import.meta.main) {
  await main(process.argv.slice(2));
  process.exit(0);
}
