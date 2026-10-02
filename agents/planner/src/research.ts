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

export interface ResearchDeps {
  think: (prompt: string) => Promise<string>;
  search: (query: string) => Promise<{ content: string; sources: ResearchSource[] }>;
  now?: () => number;
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

function researchPrompt(brief: string, findings: Finding[], mustFinish: boolean): string {
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
  const asked = new Set<string>();

  for (;;) {
    const outOfTime = now() - started > safetyMs;
    const reply = parseReply(await deps.think(researchPrompt(brief, findings, outOfTime)));
    const fresh = (reply.queries ?? []).map((q) => q.trim()).filter((q) => q && !asked.has(q.toLowerCase()));

    if (reply.done || outOfTime || fresh.length === 0) {
      const notes = reply.done && reply.notes
        ? reply.notes
        : parseReply(await deps.think(researchPrompt(brief, findings, true))).notes ?? "";
      return {
        notes,
        sources: findings.flatMap((f) => f.sources),
        queries: [...asked],
      };
    }

    for (const q of fresh) asked.add(q.toLowerCase());
    const results = await Promise.allSettled(fresh.map((q) => deps.search(q)));
    results.forEach((r, k) => {
      if (r.status === "fulfilled") findings.push({ query: fresh[k]!, content: r.value.content, sources: r.value.sources });
      else console.log(`[planner:research] search skipped (${fresh[k]}): ${String(r.reason).slice(0, 160)}`);
    });
  }
}
