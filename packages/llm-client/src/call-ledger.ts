// Per-call ledger of every Gemini call (2026-10-25, Amit: "a fully detailed costing and timing of each agent, each round, not an
// overview report").
//
// The project's spend table holds only totals per agent and model, and several paths (the planning chat, Saanvi's research, Arjun,
// the Chief AI check) were not in it at all. Every Gemini call, successful or failed, is appended to one file in the builds folder:
// model, start and end time, tokens, cache hits, and the agent, tier and project it belongs to (set by the calling loop through
// withCallContext). Cost is not stored: it is computed from the tokens with the price table when a report is made.
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CallContext {
  projectId?: string;
  agent?: string;
  tier?: string;
}

export interface CallUsage {
  tokensIn: number;
  tokensOut: number;
  cachedIn?: number;
}

export interface CallRow {
  at: string;
  startedAt: string;
  ms: number;
  kind: string;
  model: string;
  ok: boolean;
  error?: string;
  projectId?: string;
  agent?: string;
  tier?: string;
  tokensIn?: number;
  tokensOut?: number;
  cachedIn?: number;
}

const contextStore = new AsyncLocalStorage<CallContext>();
const usageStore = new AsyncLocalStorage<{ usage?: CallUsage }>();

/** Runs fn with this agent/project/tier attached to every Gemini call made inside it. */
export function withCallContext<T>(ctx: CallContext, fn: () => T): T {
  return contextStore.run({ ...contextStore.getStore(), ...ctx }, fn);
}

/** The context of the call being made right now (project, agent, tier), if one was set. */
export function currentCallContext(): CallContext | undefined {
  return contextStore.getStore();
}

/** The call's usage, noted by the client when the answer arrives. */
export function noteUsage(usage: CallUsage): void {
  const holder = usageStore.getStore();
  if (holder) holder.usage = usage;
}

export function callLedgerPath(): string {
  return join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", ".call-ledger.jsonl");
}

function write(row: CallRow): void {
  // Under `bun test` nothing is written unless a test opts in (NEXSIDI_CALL_LEDGER=on, with its own BUILD_DIR): .env sets BUILD_DIR for
  // every run, so a test's own Gemini calls would otherwise land in the real builds folder next to a real build's rows.
  if (process.env.NODE_ENV === "test" && process.env.NEXSIDI_CALL_LEDGER !== "on") return;
  try {
    appendFileSync(callLedgerPath(), JSON.stringify(row) + "\n", "utf-8");
  } catch {
    // an unwritable ledger must never break a call
  }
}

/** Runs one Gemini call and records it, whether it succeeds or fails; errors and results pass through unchanged. */
export async function recordedCall<T>(kind: string, model: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const holder: { usage?: CallUsage } = {};
  const ctx = contextStore.getStore() ?? {};
  const base = (ok: boolean): CallRow => ({
    at: new Date().toISOString(),
    startedAt: new Date(start).toISOString(),
    ms: Date.now() - start,
    kind,
    model,
    ok,
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    ...(ctx.agent ? { agent: ctx.agent } : {}),
    ...(ctx.tier ? { tier: ctx.tier } : {}),
  });
  try {
    const result = await usageStore.run(holder, fn);
    write({
      ...base(true),
      ...(holder.usage ? { tokensIn: holder.usage.tokensIn, tokensOut: holder.usage.tokensOut, ...(holder.usage.cachedIn ? { cachedIn: holder.usage.cachedIn } : {}) } : {}),
    });
    return result;
  } catch (err) {
    write({ ...base(false), error: String(err instanceof Error ? err.message : err).replace(/\s+/g, " ").slice(0, 300) });
    throw err;
  }
}

export function readCallLedger(file: string = callLedgerPath()): CallRow[] {
  if (!existsSync(file)) return [];
  const rows: CallRow[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as CallRow);
    } catch {
      // a torn line is skipped
    }
  }
  return rows;
}
