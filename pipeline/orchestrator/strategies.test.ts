import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STRATEGY_LIBRARY, pickAlternative, proposeAlternative, recordAttempt, readAttempts, alternativesSection, parseGeneratedStrategy, type Strategy } from "./strategies.ts";
import { verifyAndRepair, repairRequest, type LiveFinding, type LiveCheckResult } from "./clone-verify.ts";

// Patent claim 6(c): alternative strategy generation when primary approaches fail to achieve convergence.

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const f = (issue: string): LiveFinding => ({ file: "frontend/app/page.tsx", issue });
const bad = (...issues: string[]): LiveCheckResult => ({ ran: true, pass: false, findings: issues.map(f), notChecked: [] });
const ok = (): LiveCheckResult => ({ ran: true, pass: true, findings: [], notChecked: [] });

// ── the library ─────────────────────────────────────────────────────────────
test("the library holds several clearly different approaches, each with an instruction a builder can follow", () => {
  expect(STRATEGY_LIBRARY.length).toBeGreaterThanOrEqual(5);
  expect(new Set(STRATEGY_LIBRARY.map((s) => s.id)).size).toBe(STRATEGY_LIBRARY.length);
  for (const s of STRATEGY_LIBRARY) {
    expect(s.title.length).toBeGreaterThan(5);
    expect(s.instruction.length).toBeGreaterThan(60);
  }
});

test("pickAlternative gives the first approach not yet tried, and nothing when all were tried", () => {
  const first = pickAlternative([])!;
  expect(first.id).toBe(STRATEGY_LIBRARY[0]!.id);
  expect(pickAlternative([first.id])!.id).toBe(STRATEGY_LIBRARY[1]!.id);
  expect(pickAlternative(STRATEGY_LIBRARY.map((s) => s.id))).toBeNull();
});

// ── the record of what was tried ────────────────────────────────────────────
test("every attempt is recorded with the findings it was meant to fix and read back in order", () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-strat-"));
  recordAttempt(dir, { stage: "express-live", findings: ["a"], strategyId: "one", title: "One" });
  recordAttempt(dir, { stage: "express-live", findings: ["a"], strategyId: "two", title: "Two" });
  const rows = readAttempts(dir);
  expect(rows.map((r) => r.strategyId)).toEqual(["one", "two"]);
  expect(rows[0]!.findings).toEqual(["a"]);
  expect(existsSync(join(dir, "strategies.jsonl"))).toBe(true);
});

test("reading attempts from a folder with no record gives an empty list", () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-strat-"));
  expect(readAttempts(dir)).toEqual([]);
});

// ── generating one for these findings ───────────────────────────────────────
test("a generated approach is used when one is offered and it is genuinely new", async () => {
  const generated: Strategy = { id: "gen-1", title: "Rebuild the totals from the invoice lines", instruction: "Recompute the totals on the server from the stored lines instead of trusting the figures the screen sends, then show those.", source: "model" };
  const r = await proposeAlternative({ findings: ["x"], tried: [], generate: async () => generated });
  expect(r?.id).toBe("gen-1");
  expect(r?.source).toBe("model");
});

test("a generated approach that repeats one already tried is ignored in favour of the library", async () => {
  const lib = STRATEGY_LIBRARY[0]!;
  const r = await proposeAlternative({ findings: ["x"], tried: [lib.id], generate: async () => ({ ...lib, id: "again", source: "model" as const }) });
  expect(r?.source).toBe("library");
  expect(r?.id).toBe(STRATEGY_LIBRARY[1]!.id);
});

test("when generation fails or returns nothing, the library supplies the approach", async () => {
  expect((await proposeAlternative({ findings: ["x"], tried: [], generate: async () => { throw new Error("model down"); } }))?.source).toBe("library");
  expect((await proposeAlternative({ findings: ["x"], tried: [], generate: async () => null }))?.source).toBe("library");
  expect((await proposeAlternative({ findings: ["x"], tried: [] }))?.source).toBe("library");
});

test("with every approach tried and none generated, there is no alternative", async () => {
  expect(await proposeAlternative({ findings: ["x"], tried: STRATEGY_LIBRARY.map((s) => s.id) })).toBeNull();
});

test("parseGeneratedStrategy reads a model's JSON answer, with or without fences, and rejects anything unusable", () => {
  const good = parseGeneratedStrategy('```json\n{"title":"Fix it at the source","instruction":"Change the shared helper every page uses, not each page, and prove it with one request."}\n```');
  expect(good?.title).toBe("Fix it at the source");
  expect(good?.source).toBe("model");
  expect(parseGeneratedStrategy("no json here")).toBeNull();
  expect(parseGeneratedStrategy('{"title":"x","instruction":"too short"}')).toBeNull();
});

// ── inside the repair loop ──────────────────────────────────────────────────
test("the repair request carries the new approach when one is given, and says the last try did not work", () => {
  const s = STRATEGY_LIBRARY[2]!;
  const text = repairRequest([f("[route-sweep] /x threw an uncaught error: boom")], s);
  expect(text).toContain(s.title);
  expect(text).toContain(s.instruction);
  expect(text.toLowerCase()).toContain("did not fix");
  expect(repairRequest([f("[route-sweep] /x boom")])).not.toContain("did not fix");
});

test("verifyAndRepair keeps the first repair as it is, then asks for a different approach when the same problem comes back", async () => {
  const finding = "[route-sweep] /plants/x (signed-in) threw an uncaught error: a is not iterable";
  const checks = [bad(finding), bad(finding), ok()];
  const seen: Array<string | undefined> = [];
  const asked: string[][] = [];
  const r = await verifyAndRepair({
    liveCheck: async () => checks.shift()!,
    repair: async (_found, strategy) => { seen.push(strategy?.id); },
    alternative: async (_found, tried) => { asked.push(tried); return STRATEGY_LIBRARY[tried.length]!; },
    maxRepairs: 3,
  });
  expect(r.pass).toBe(true);
  expect(r.rounds).toBe(2);
  expect(seen).toEqual([undefined, STRATEGY_LIBRARY[0]!.id]);
  expect(asked).toEqual([[]]);
});

test("verifyAndRepair does not ask for a different approach when the next problem is a new one", async () => {
  const checks = [bad("[route-sweep] /a threw an uncaught error: one"), bad("[route-sweep] /b threw an uncaught error: two"), ok()];
  let asked = 0;
  await verifyAndRepair({ liveCheck: async () => checks.shift()!, repair: async () => {}, alternative: async () => { asked += 1; return STRATEGY_LIBRARY[0]!; }, maxRepairs: 3 });
  expect(asked).toBe(0);
});

test("verifyAndRepair never offers the same approach twice for a problem that keeps coming back", async () => {
  const finding = "[route-sweep] /x threw an uncaught error: boom";
  const used: string[] = [];
  await verifyAndRepair({
    liveCheck: async () => bad(finding),
    repair: async (_f, strategy) => { if (strategy) used.push(strategy.id); },
    alternative: async (_f, tried) => pickAlternative(tried),
    maxRepairs: 4,
  });
  expect(new Set(used).size).toBe(used.length);
  expect(used.length).toBe(3);
});

// ── the hold report ─────────────────────────────────────────────────────────
test("the hold report lists approaches that have not been tried yet", () => {
  const section = alternativesSection([STRATEGY_LIBRARY[0]!.id]);
  expect(section).toContain("Different approaches");
  expect(section).not.toContain(STRATEGY_LIBRARY[0]!.title);
  expect(section).toContain(STRATEGY_LIBRARY[1]!.title);
  expect(readFileSync).toBeDefined();
});

test("the same problem with a different sample record id still counts as having come back", async () => {
  const a = "[route-sweep] /plants/0cb2bb87-6b64-480a-b9e4-5aead91b2e91 (signed-in) threw an uncaught error: a is not iterable";
  const b = "[route-sweep] /plants/a8d91e15-f3f8-43da-8651-483d42aa43a5 (signed-in) threw an uncaught error: a is not iterable";
  const checks = [bad(a), bad(b), ok()];
  let asked = 0;
  await verifyAndRepair({ liveCheck: async () => checks.shift()!, repair: async () => {}, alternative: async () => { asked += 1; return STRATEGY_LIBRARY[0]!; }, maxRepairs: 3 });
  expect(asked).toBe(1);
});
