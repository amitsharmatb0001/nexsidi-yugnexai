import { test, expect } from "bun:test";
import { binomialTail, evaluatePatterns, type Occurrence } from "./instinct-stats.ts";

// Patent claim 7: recurring patterns across projects are extracted by statistical methods, not by a bare counter.

const occ = (domain: string, trigger: string, projectId: string): Occurrence => ({ domain, trigger, projectId });

test("binomialTail gives the exact chance of at least k successes", () => {
  // P(X >= 0) is always 1; P(X >= n+1) is 0.
  expect(binomialTail(0, 10, 0.3)).toBeCloseTo(1, 10);
  expect(binomialTail(11, 10, 0.3)).toBe(0);
  // 3 fair coin flips, at least 3 heads = 1/8.
  expect(binomialTail(3, 3, 0.5)).toBeCloseTo(0.125, 10);
  // 4 flips, at least 2 heads = 11/16.
  expect(binomialTail(2, 4, 0.5)).toBeCloseTo(11 / 16, 10);
});

test("binomialTail stays valid at the edges of the probability range", () => {
  expect(binomialTail(1, 5, 0)).toBe(0);
  expect(binomialTail(5, 5, 1)).toBe(1);
  expect(binomialTail(3, 0, 0.5)).toBe(0);
});

test("a pattern seen in many of the projects, far above the background rate, is significant", () => {
  const rows: Occurrence[] = [];
  // 20 projects. Pattern A shows up in 12 of them. Fifteen other patterns each show up in one project only.
  for (let p = 1; p <= 12; p++) rows.push(occ("security", "string-built sql", `p${p}`));
  for (let i = 0; i < 15; i++) rows.push(occ("performance", `rare-${i}`, `p${(i % 20) + 1}`));
  const r = evaluatePatterns(rows, { totalProjects: 20 });
  const a = r.find((x) => x.trigger === "string-built sql")!;
  expect(a.projectCount).toBe(12);
  expect(a.occurrences).toBe(12);
  expect(a.significant).toBe(true);
  expect(a.pValue).toBeLessThan(0.001);
  expect(a.score).toBeGreaterThan(3);
});

test("a pattern seen in one project only is never significant, however often it repeats there", () => {
  const rows = Array.from({ length: 30 }, () => occ("security", "one-project-bug", "p1"));
  const r = evaluatePatterns(rows, { totalProjects: 20 });
  expect(r[0]!.projectCount).toBe(1);
  expect(r[0]!.occurrences).toBe(30);
  expect(r[0]!.significant).toBe(false);
  expect(r[0]!.reason).toContain("fewer than");
});

test("a pattern seen in two projects out of two is not enough evidence on its own", () => {
  const r = evaluatePatterns([occ("security", "x", "p1"), occ("security", "x", "p2")], { totalProjects: 2 });
  expect(r[0]!.significant).toBe(false);
});

test("the background rate comes from the data, so a common pattern is judged against how common patterns are", () => {
  const rows: Occurrence[] = [];
  // Every pattern appears in about half of 10 projects: a busy background. Five projects for one pattern is then unremarkable.
  for (let i = 0; i < 6; i++) for (let p = 1; p <= 5; p++) rows.push(occ("security", `common-${i}`, `p${p + (i % 2)}`));
  const r = evaluatePatterns(rows, { totalProjects: 10 });
  expect(r.every((x) => !x.significant)).toBe(true);
});

test("results are controlled for false discoveries across many patterns", () => {
  // 40 patterns each seen in 3 of 30 projects. With a 0.05 cutoff and no correction a few might pass by luck; none should.
  const rows: Occurrence[] = [];
  for (let i = 0; i < 40; i++) for (let k = 0; k < 3; k++) rows.push(occ("code-style", `noise-${i}`, `p${((i * 7 + k * 11) % 30) + 1}`));
  const r = evaluatePatterns(rows, { totalProjects: 30 });
  expect(r.filter((x) => x.significant).length).toBe(0);
});

test("the same project counted many times does not inflate the project count", () => {
  const rows = [occ("security", "x", "p1"), occ("security", "x", "p1"), occ("security", "x", "p2"), occ("security", "x", "p2"), occ("security", "x", "p3")];
  const r = evaluatePatterns(rows, { totalProjects: 40 });
  expect(r[0]!.projectCount).toBe(3);
  expect(r[0]!.occurrences).toBe(5);
});

test("occurrences without a project are kept for counting but cannot support a cross-project claim", () => {
  const rows = [occ("security", "x", ""), occ("security", "x", ""), occ("security", "x", "")];
  const r = evaluatePatterns(rows, { totalProjects: 10 });
  expect(r[0]!.occurrences).toBe(3);
  expect(r[0]!.projectCount).toBe(0);
  expect(r[0]!.significant).toBe(false);
});

test("an empty log gives no results, and a log with fewer total projects than seen is corrected upward", () => {
  expect(evaluatePatterns([], { totalProjects: 5 })).toEqual([]);
  const r = evaluatePatterns([occ("a", "t", "p1"), occ("a", "t", "p2"), occ("a", "t", "p3")], { totalProjects: 1 });
  expect(r[0]!.projectCount).toBe(3);
  expect(Number.isFinite(r[0]!.pValue)).toBe(true);
});

test("results are ordered most significant first", () => {
  const rows: Occurrence[] = [];
  for (let p = 1; p <= 10; p++) rows.push(occ("security", "strong", `p${p}`));
  for (let p = 1; p <= 4; p++) rows.push(occ("security", "weaker", `p${p}`));
  const r = evaluatePatterns(rows, { totalProjects: 30 });
  expect(r[0]!.trigger).toBe("strong");
  expect(r[0]!.score).toBeGreaterThan(r[1]!.score);
});
