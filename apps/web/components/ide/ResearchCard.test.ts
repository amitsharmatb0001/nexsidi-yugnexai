import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { sourceLabel, distinctSources } from "./ResearchCard.tsx";

// 2026-10-03 (Amit, run 4): the planner's research appeared as one wall of
// raw markdown with long Google redirect links, all at once at the end.
// Now: live steps while it runs, then a collapsed line with sources by site.

const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH-SCQcielOa-VOEk0OqwV6TVw8OaABHtJTDQhACzdVEp3Sw6zO";

test("a source shows its site name, never the long redirect link", () => {
  expect(sourceLabel({ title: "taxguru.in", url: REDIRECT })).toBe("taxguru.in");
  expect(sourceLabel({ title: "", url: "https://www.indiafilings.com/learn/gst-invoice" })).toBe("indiafilings.com");
});

test("each site is listed once", () => {
  const sites = distinctSources([
    { title: "indiafilings.com", url: REDIRECT + "1" },
    { title: "indiafilings.com", url: REDIRECT + "2" },
    { title: "taxguru.in", url: REDIRECT + "3" },
  ]);
  expect(sites.map((s) => s.label)).toEqual(["indiafilings.com", "taxguru.in"]);
});

test("the planning chat renders formatting, shows research as a card, and streams the research steps live", () => {
  const ws = readFileSync(new URL("./IdeWorkspace.tsx", import.meta.url), "utf-8");
  expect(ws).toContain("<ResearchCard research={m.research}");
  expect(ws).toContain("<ResearchLive steps={planning.researchLive}");
  expect(ws).toContain("<PlanDocument source={m.content}");
  const page = readFileSync(new URL("../../app/build/[id]/page.tsx", import.meta.url), "utf-8");
  expect(page).toContain('chunk.type === "research_progress"');
  expect(page).toContain("researchLive");
  expect(page).not.toContain("**What I found**");
});
