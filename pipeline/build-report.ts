// Cost and time report of a build, call by call (2026-10-25, Amit: "a fully detailed costing and timing of each agent, each round, not an
// overview report"). Built only from recorded facts: the per-call ledger (packages/llm-client/src/call-ledger.ts: model, start and end,
// tokens, cache, agent, ok or failed), the workflow's own step times, and the review rounds (rounds.jsonl). Nothing is estimated; calls the
// ledger could not attribute to an agent and models with no price are listed as such.
import type { CallRow } from "../packages/llm-client/src/call-ledger.ts";

export interface Activity {
  name: string;
  start: number;
  end: number;
}
export interface RoundMark {
  at: number;
  stage: string;
  findings: number;
}
export interface Window {
  label: string;
  from: number;
  to: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The build's timeline as windows that tile it: each workflow step, split into one window per review round it contains. */
export function buildWindows(activities: Activity[], rounds: RoundMark[], _endMs: number, opts: { planningFrom?: number } = {}): Window[] {
  const acts = [...activities].sort((a, b) => a.start - b.start);
  const out: Window[] = [];
  if (acts.length > 0 && opts.planningFrom !== undefined && opts.planningFrom < acts[0]!.start) {
    out.push({ label: "planning chat (before the build started)", from: opts.planningFrom, to: acts[0]!.start });
  }
  const counters: Record<string, number> = {};
  const roundWord = (stage: string) => (stage === "live" ? "live round" : "code review round");
  const afterWord = (stage: string, name: string) => (stage === "live" ? "deploy and live checks: after the last round" : stage === "qa" ? "code review: after the last round" : `${name}: after the last round`);
  let prevEnd: number | null = null;
  for (const a of acts) {
    if (prevEnd !== null && a.start - prevEnd >= 1000) out.push({ label: "waiting (between steps)", from: prevEnd, to: a.start });
    const inside = rounds.filter((r) => r.at > a.start && r.at <= a.end).sort((x, y) => x.at - y.at);
    if (inside.length === 0) {
      out.push({ label: a.name, from: a.start, to: a.end });
    } else {
      let from = a.start;
      for (const r of inside) {
        counters[r.stage] = (counters[r.stage] ?? 0) + 1;
        out.push({ label: `${roundWord(r.stage)} ${counters[r.stage]} (${plural(r.findings, "finding")})`, from, to: r.at });
        from = r.at;
      }
      if (a.end - from >= 1000) out.push({ label: afterWord(inside[inside.length - 1]!.stage, a.name), from, to: a.end });
    }
    prevEnd = a.end;
  }
  return out;
}

export interface AgentStat {
  agent: string;
  callsOk: number;
  callsFailed: number;
  models: Record<string, number>;
  tokensIn: number;
  tokensOut: number;
  cachedIn: number;
  cachePct: number;
  costUsd: number;
  callSeconds: number;
  okSeconds: number;
  failedSeconds: number;
  firstStart: number;
  lastEnd: number;
}
export interface Section {
  label: string;
  from: number;
  to: number;
  agents: AgentStat[];
  total: AgentStat;
}
export interface FailedCall {
  at: number;
  agent: string;
  model: string;
  seconds: number;
  error: string;
}
export interface ModelStat {
  model: string;
  callsOk: number;
  callsFailed: number;
  tokensIn: number;
  tokensOut: number;
  cachedIn: number;
  costUsd: number;
  okSeconds: number;
  failedSeconds: number;
}
export interface Report {
  sections: Section[];
  total: AgentStat;
  byAgent: AgentStat[];
  byModel: ModelStat[];
  failures: FailedCall[];
  unpriced: string[];
}

export type PriceFn = (model: string, tokensIn: number, tokensOut: number, cachedIn: number) => number;

const NO_AGENT = "(no agent named)";

function blank(agent: string): AgentStat {
  return { agent, callsOk: 0, callsFailed: 0, models: {}, tokensIn: 0, tokensOut: 0, cachedIn: 0, cachePct: 0, costUsd: 0, callSeconds: 0, okSeconds: 0, failedSeconds: 0, firstStart: Infinity, lastEnd: 0 };
}

function add(stat: AgentStat, row: CallRow, cost: number): void {
  const start = Date.parse(row.startedAt);
  const end = Date.parse(row.at);
  if (row.ok) {
    stat.callsOk++;
    stat.okSeconds += row.ms / 1000;
  } else {
    stat.callsFailed++;
    stat.failedSeconds += row.ms / 1000;
  }
  stat.callSeconds += row.ms / 1000;
  stat.models[row.model] = (stat.models[row.model] ?? 0) + 1;
  stat.tokensIn += row.tokensIn ?? 0;
  stat.tokensOut += row.tokensOut ?? 0;
  stat.cachedIn += row.cachedIn ?? 0;
  stat.costUsd += cost;
  stat.firstStart = Math.min(stat.firstStart, start);
  stat.lastEnd = Math.max(stat.lastEnd, end);
  stat.cachePct = stat.tokensIn > 0 ? (stat.cachedIn / stat.tokensIn) * 100 : 0;
}

export function aggregate(rows: CallRow[], windows: Window[], price: PriceFn): Report {
  const unpriced = new Set<string>();
  const costOf = (r: CallRow): number => {
    if (!r.ok || r.tokensIn === undefined) return 0;
    const c = price(r.model, r.tokensIn, r.tokensOut ?? 0, r.cachedIn ?? 0);
    if (!Number.isFinite(c)) {
      unpriced.add(r.model);
      return 0;
    }
    return c;
  };
  const sections: Section[] = windows.map((w) => ({ label: w.label, from: w.from, to: w.to, agents: [], total: blank("all") }));
  const before: Section = { label: "before the first step", from: -Infinity, to: windows[0]?.from ?? 0, agents: [], total: blank("all") };
  const after: Section = { label: "after the build ended", from: windows[windows.length - 1]?.to ?? 0, to: Infinity, agents: [], total: blank("all") };
  const total = blank("all");
  const byAgent = new Map<string, AgentStat>();
  const byModel = new Map<string, ModelStat>();
  const failures: FailedCall[] = [];
  const perSection = new Map<Section, Map<string, AgentStat>>();

  for (const row of rows) {
    const end = Date.parse(row.at);
    const section = sections.find((s) => end >= s.from && end < s.to) ?? (end < (windows[0]?.from ?? 0) ? before : after);
    const agent = row.agent ?? NO_AGENT;
    const cost = costOf(row);
    const map = perSection.get(section) ?? new Map<string, AgentStat>();
    perSection.set(section, map);
    add(map.get(agent) ?? (map.set(agent, blank(agent)), map.get(agent)!), row, cost);
    add(section.total, row, cost);
    add(total, row, cost);
    add(byAgent.get(agent) ?? (byAgent.set(agent, blank(agent)), byAgent.get(agent)!), row, cost);
    const m = byModel.get(row.model) ?? { model: row.model, callsOk: 0, callsFailed: 0, tokensIn: 0, tokensOut: 0, cachedIn: 0, costUsd: 0, okSeconds: 0, failedSeconds: 0 };
    byModel.set(row.model, m);
    if (row.ok) {
      m.callsOk++;
      m.okSeconds += row.ms / 1000;
    } else {
      m.callsFailed++;
      m.failedSeconds += row.ms / 1000;
    }
    m.tokensIn += row.tokensIn ?? 0;
    m.tokensOut += row.tokensOut ?? 0;
    m.cachedIn += row.cachedIn ?? 0;
    m.costUsd += cost;
    if (!row.ok) failures.push({ at: end, agent, model: row.model, seconds: row.ms / 1000, error: row.error ?? "" });
  }
  const finish = (s: Section) => {
    s.agents = [...(perSection.get(s)?.values() ?? [])].sort((a, b) => (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));
    return s;
  };
  sections.forEach(finish);
  const out = [...(perSection.has(before) ? [finish(before)] : []), ...sections, ...(perSection.has(after) ? [finish(after)] : [])];
  return {
    sections: out,
    total,
    byAgent: [...byAgent.values()].sort((a, b) => b.costUsd - a.costUsd),
    byModel: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd),
    failures: failures.sort((a, b) => a.at - b.at),
    unpriced: [...unpriced],
  };
}

const hhmmss = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 19) : "-");
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const modelsText = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name.replace("gemini-", "")}×${n}`).join(", ");

function row(a: AgentStat): string {
  const wall = a.firstStart === Infinity ? 0 : (a.lastEnd - a.firstStart) / 1000;
  return `| ${a.agent} | ${a.callsOk} | ${a.callsFailed} | ${modelsText(a.models)} | ${k(a.tokensIn)} | ${k(a.tokensOut)} | ${k(a.cachedIn)} | ${a.cachePct.toFixed(0)}% | ${usd(a.costUsd)} | ${mmss(a.okSeconds)} | ${mmss(a.failedSeconds)} | ${mmss(wall)} |`;
}
const HEADER = "| agent | ok | failed | models (calls) | tokens in | out | cached | cache | cost | call time (ok) | wasted on failed | first→last call |\n|---|---|---|---|---|---|---|---|---|---|---|---|";

export function renderReport(name: string, report: Report, extra: { agentSpendUsd?: number; workflowMinutes?: number } = {}): string {
  const lines: string[] = [];
  const t = report.total;
  lines.push(`# ${name} — cost and time, agent by agent, round by round`);
  lines.push("");
  lines.push(`Built from the per-call ledger: ${t.callsOk + t.callsFailed} model calls (${t.callsOk} answered, ${t.callsFailed} failed), cost ${usd(t.costUsd)}, ${mmss(t.okSeconds)} of answered-call time and ${mmss(t.failedSeconds)} wasted on failed calls (parallel calls overlap, so call time is not wall-clock time).${extra.workflowMinutes !== undefined ? ` The build ran ${extra.workflowMinutes} min.` : ""}`);
  lines.push("");
  for (const s of report.sections) {
    const span = s.to === Infinity || s.from === -Infinity ? "" : ` — ${hhmmss(s.from)}–${hhmmss(s.to)} UTC, ${mmss((s.to - s.from) / 1000)}`;
    lines.push(`## ${s.label}${span}`);
    lines.push("");
    if (s.agents.length === 0) {
      lines.push("No model calls in this window.");
      lines.push("");
      continue;
    }
    lines.push(HEADER);
    for (const a of s.agents) lines.push(row(a));
    lines.push(row({ ...s.total, agent: "**window total**" }));
    lines.push("");
  }
  lines.push("## Failed calls");
  lines.push("");
  if (report.failures.length === 0) lines.push("None.");
  else {
    lines.push("| time (UTC) | agent | model | waited | reason |\n|---|---|---|---|---|");
    for (const f of report.failures) lines.push(`| ${hhmmss(f.at)} | ${f.agent} | ${f.model} | ${f.seconds.toFixed(1)} s | ${f.error.slice(0, 110)} |`);
  }
  lines.push("");
  lines.push("## Totals by agent");
  lines.push("");
  lines.push(HEADER);
  for (const a of report.byAgent) lines.push(row(a));
  lines.push("");
  lines.push("## Totals by model");
  lines.push("");
  lines.push("| model | ok | failed | tokens in | out | cached | cost | call time (ok) | wasted on failed |\n|---|---|---|---|---|---|---|---|---|");
  for (const m of report.byModel) lines.push(`| ${m.model} | ${m.callsOk} | ${m.callsFailed} | ${k(m.tokensIn)} | ${k(m.tokensOut)} | ${k(m.cachedIn)} | ${usd(m.costUsd)} | ${mmss(m.okSeconds)} | ${mmss(m.failedSeconds)} |`);
  lines.push("");
  lines.push("## Reconciliation");
  lines.push("");
  lines.push(`- This ledger: ${usd(t.costUsd)}${extra.agentSpendUsd !== undefined ? `; the project's agent_spend table (the older record, which holds only the agents' own loops) says ${usd(extra.agentSpendUsd)}. The difference is the calls that table never recorded (planning, research, the Chief AI check, and anything else outside an agent loop).` : "."}`);
  if (report.unpriced.length > 0) lines.push(`- NOT PRICED (cost counted as $0, tokens shown): ${report.unpriced.join(", ")}.`);
  lines.push("- Calls whose agent was not named are listed under \"(no agent named)\" in the window they ended in; they are included in every total.");
  return lines.join("\n") + "\n";
}
