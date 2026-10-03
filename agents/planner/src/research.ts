// Research before the first question (Part B of the agentic planner plan,
// approved by Amit, 2 Oct 2026). The planner never researched: searches were
// cut off at 10 s and no rule asked for it, so every product got the same
// template questions. This runs in code — models skip optional tools — but
// how deep it goes is the model's call: it chooses each round's searches and
// decides when it knows enough. No fixed number of searches; only the
// safety time (the user is waiting in the chat) ends it early, and even then
// it writes notes from what it found.
import { geminiWebSearch, routeWithFallback } from "@nexsidi/llm-client";

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchNotes {
  notes: string;
  sources: ResearchSource[];
  queries: string[];
}

// Each search as it starts and finishes, so the chat can show the research
// live (like Claude Code's "Searched the web" steps) instead of one wall of
// text at the end (Amit, run 4).
export type ResearchProgress =
  | { type: "search_started"; query: string }
  | { type: "search_done"; query: string; ok: boolean; sources: number };

export interface ResearchDeps {
  think: (prompt: string) => Promise<string>;
  search: (query: string) => Promise<{ content: string; sources: ResearchSource[] }>;
  now?: () => number;
  onProgress?: (event: ResearchProgress) => void;
}

const DEFAULT_SAFETY_MS = Number(process.env.PLANNER_RESEARCH_SAFETY_MINUTES ?? 15) * 60_000;

export const defaultResearchDeps: ResearchDeps = {
  think: async (prompt) => (await routeWithFallback("plan", [{ role: "user", content: prompt }])).content,
  search: (query) => geminiWebSearch(query),
};

interface Finding {
  query: string;
  content: string;
  sources: ResearchSource[];
}

function researchPrompt(brief: string, findings: Finding[], mustFinish: boolean, mustSearch = false): string {
  if (mustSearch) {
    return `You are the research lead of a senior product team. A customer wants this built:

${brief}

You have not searched anything yet, and your memory may be out of date or miss what real
users of similar products expect today. List the web searches you need now: the domain's
current rules and regulations, well-known similar products and their features, and common
failure points.

Reply with JSON only: {"queries": ["search 1", "search 2", ...]}`;
  }
  const found = findings.length
    ? findings.map((f) => `### ${f.query}\n${f.content.slice(0, 2500)}`).join("\n\n")
    : "(nothing searched yet)";
  return `You are the research lead of a senior product team. A customer wants this built:

${brief}

Before anyone asks the customer a question, learn what a senior team would know: the rules
and regulations of this domain, well-known similar products and what their users expect,
common mistakes and failure points, and anything in the brief that needs a decision.

What you have found so far:
${found}

${mustFinish
    ? "Stop searching now and write the notes."
    : "Either ask for the next searches, or — when you know enough — write the notes."}

Reply with JSON only, one of:
{"queries": ["search 1", "search 2", ...]}   — as many searches as you need this round
{"done": true, "notes": "..."}               — the notes, in short bullet lines under three headings:
  Must-know rules / What users expect / Questions worth asking the customer (each with why it matters)`;
}

function parseReply(text: string): { queries?: string[]; done?: boolean; notes?: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { done: true, notes: text.trim() };
  try {
    return JSON.parse(match[0]);
  } catch {
    return { done: true, notes: text.trim() };
  }
}

export async function researchBrief(
  brief: string,
  deps: ResearchDeps = defaultResearchDeps,
  opts: { safetyMs?: number } = {},
): Promise<ResearchNotes> {
  const now = deps.now ?? Date.now;
  const started = now();
  const safetyMs = opts.safetyMs ?? DEFAULT_SAFETY_MS;
  const findings: Finding[] = [];
  const asked = new Set<string>(); // lower-case, to spot repeats
  const queries: string[] = [];    // as the model wrote them, for display

  for (;;) {
    const outOfTime = now() - started > safetyMs;
    let reply = parseReply(await deps.think(researchPrompt(brief, findings, outOfTime)));
    // Live check 2 Oct 2026: the model sometimes says "done" before searching
    // anything — notes from memory, not research. Research searches at least
    // once; how many searches after that is still the model's call.
    if (!outOfTime && asked.size === 0 && !(reply.queries ?? []).some((q) => q.trim())) {
      reply = parseReply(await deps.think(researchPrompt(brief, findings, false, true)));
    }
    const fresh = (reply.queries ?? []).map((q) => q.trim()).filter((q) => q && !asked.has(q.toLowerCase()));

    if (reply.done || outOfTime || fresh.length === 0) {
      const notes = reply.done && reply.notes
        ? reply.notes
        : parseReply(await deps.think(researchPrompt(brief, findings, true))).notes ?? "";
      return {
        notes,
        sources: findings.flatMap((f) => f.sources),
        queries,
      };
    }

    for (const q of fresh) { asked.add(q.toLowerCase()); queries.push(q); }
    for (const q of fresh) deps.onProgress?.({ type: "search_started", query: q });
    const results = await Promise.allSettled(fresh.map((q) => deps.search(q)));
    results.forEach((r, k) => {
      deps.onProgress?.({ type: "search_done", query: fresh[k]!, ok: r.status === "fulfilled", sources: r.status === "fulfilled" ? r.value.sources.length : 0 });
      if (r.status === "fulfilled") findings.push({ query: fresh[k]!, content: r.value.content, sources: r.value.sources });
      else console.log(`[planner:research] search skipped (${fresh[k]}): ${String(r.reason).slice(0, 160)}`);
    });
  }
}
