import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { researchBrief, type ResearchDeps } from "./research.ts";
import { needsResearch, buildPlannerSystemPrompt, plannerTurnShouldStop, streamReply } from "./index.ts";
import { newSession } from "./session.ts";

// 2026-10-02 (Part B of the agentic planner plan, approved by Amit): the
// planner never researched — searches were cut off and no rule asked for
// it — so it asked the same template questions for every product. Research
// now runs in code before the first question; how deep it goes is the
// model's call, with no fixed number of searches.

function fakeDeps(script: string[], failOn: string[] = []) {
  const searched: string[] = [];
  let i = 0;
  const deps: ResearchDeps = {
    think: async () => script[Math.min(i++, script.length - 1)]!,
    search: async (q) => {
      searched.push(q);
      if (failOn.includes(q)) throw new Error("search failed");
      return { content: `facts about ${q}`, sources: [{ title: `src ${q}`, url: `https://example.com/${encodeURIComponent(q)}` }] };
    },
  };
  return { deps, searched };
}

const DONE = JSON.stringify({ done: true, notes: "Must-know: GST invoices need the buyer's GSTIN.\nUsers expect: PDF invoices.\nAsk: B2B or B2C?" });

test("research runs the searches the model chooses, round after round, then returns notes with sources", async () => {
  const { deps, searched } = fakeDeps([
    JSON.stringify({ queries: ["GST invoice rules", "Zoho Books features"] }),
    JSON.stringify({ queries: ["freelancer invoicing pain points"] }),
    DONE,
  ]);
  const r = await researchBrief("Build Ledgerly — GST invoicing", deps);
  expect(searched).toEqual(["GST invoice rules", "Zoho Books features", "freelancer invoicing pain points"]);
  expect(r.notes).toContain("GSTIN");
  expect(r.sources.map((s) => s.title)).toContain("src Zoho Books features");
});

test("the number of searches is the model's choice — no fixed count", async () => {
  const nine = Array.from({ length: 9 }, (_, k) => `query ${k}`);
  const { deps, searched } = fakeDeps([JSON.stringify({ queries: nine }), DONE]);
  await researchBrief("brief", deps);
  expect(searched.length).toBe(9);
});

test("a failed search is skipped, not fatal", async () => {
  const { deps } = fakeDeps([JSON.stringify({ queries: ["ok one", "broken one"] }), DONE], ["broken one"]);
  const r = await researchBrief("brief", deps);
  expect(r.notes).toContain("GSTIN");
  expect(r.sources.some((s) => s.title === "src broken one")).toBe(false);
});

test("research ends when the model has no new searches, and still writes notes", async () => {
  const { deps, searched } = fakeDeps([
    JSON.stringify({ queries: ["a"] }),
    JSON.stringify({ queries: ["a"] }), // nothing new
    DONE,
  ]);
  const r = await researchBrief("brief", deps);
  expect(searched).toEqual(["a"]);
  expect(r.notes).toContain("GSTIN");
});

test("the run's safety time ends research with notes, not a crash", async () => {
  let t = 0;
  const { deps } = fakeDeps([JSON.stringify({ queries: ["a"] }), JSON.stringify({ queries: ["b"] }), DONE]);
  deps.now = () => (t += 10 * 60_000);
  const r = await researchBrief("brief", deps, { safetyMs: 15 * 60_000 });
  expect(r.notes).toContain("GSTIN");
});

test("research happens once per session, before the first question", async () => {
  const state = newSession("u1", "s1");
  state.messages.push({ role: "user", content: "Build Ledgerly — GST invoicing", ts: 1 });
  expect(needsResearch(state)).toBe(true);
  let calls = 0;
  const gen = streamReply(state, "", { research: async () => { calls++; return { notes: "GST notes", sources: [], queries: ["q"] }; } });
  const first = await gen.next();
  const second = await gen.next();
  await gen.return(undefined);
  expect(first.value?.type).toBe("research_status");
  expect(second.value?.type).toBe("research_done");
  expect(calls).toBe(1);
  expect(state.research?.notes).toBe("GST notes");
  expect(needsResearch(state)).toBe(false);
});

test("the planner's instructions include the research notes", () => {
  const state = newSession("u1", "s1");
  state.messages.push({ role: "user", content: "brief", ts: 1 });
  state.research = { notes: "Must-know: Rule 46 of the CGST Rules", sources: [], queries: [] };
  expect(buildPlannerSystemPrompt(state)).toContain("Rule 46 of the CGST Rules");
});

test("a planner turn has no round cap: it stops on a repeated identical search or the safety time", () => {
  const seen = new Set<string>();
  expect(plannerTurnShouldStop(seen, 'web_search {"query":"a"}', 0, 1000, 60_000)).toBe(false);
  expect(plannerTurnShouldStop(seen, 'web_search {"query":"b"}', 0, 1000, 60_000)).toBe(false);
  expect(plannerTurnShouldStop(seen, 'web_search {"query":"a"}', 0, 1000, 60_000)).toBe(true);
  expect(plannerTurnShouldStop(new Set(), 'web_search {"query":"c"}', 0, 61_000, 60_000)).toBe(true);
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).not.toContain("MAX_TOOL_ROUNDS");
});

test("the API returns the research with the chat, and the build page shows it as 'What I found'", () => {
  const chat = readFileSync(new URL("../../../apps/api/src/routes/chat.ts", import.meta.url), "utf-8");
  expect(chat).toContain("research: state?.research");
  const page = readFileSync(new URL("../../../apps/web/app/build/[id]/page.tsx", import.meta.url), "utf-8");
  expect(page).toContain("research_done");
  expect(page).toContain("What I found");
});
