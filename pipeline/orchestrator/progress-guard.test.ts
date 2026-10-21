import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findingKey, judgeRound, checkRoundGuard, readRounds, type RoundRecord } from "./progress-guard.ts";

// 2026-10-04 (Ledgerly run 4, overnight): the same false finding came back
// round after round and the system kept paying for new rounds. Amit's rule:
// when work stops making progress the system HOLDS and reports to the
// developer — not a single dollar goes to a round that can only repeat itself.
// Deterministic: no model calls, no cost.
const prev = process.env.BUILD_DIR;
let dir = "";
afterEach(() => {
  process.env.BUILD_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
const setup = () => {
  dir = mkdtempSync(join(tmpdir(), "guard-"));
  process.env.BUILD_DIR = dir;
};
const f = (issue: string, file = "frontend/app") => ({ file, issue });
const round = (stage: "qa" | "live", findings: string[], spendUsd: number): RoundRecord => ({ at: "t", stage, findings, spendUsd });
const OPTS = { roundSpendCapUsd: 8 };

test("findingKey ignores ids and spacing so the same finding matches itself", () => {
  const a = findingKey(f("[logic/HIGH]  did not persist (id=8866159a-4eed-4039-aaf0-64648c3b318c)"));
  const b = findingKey(f("[logic/HIGH] did not persist (id=f9d7e378-9d35-4177-aa03-48c7d052601a)"));
  expect(a).toBe(b);
  expect(findingKey(f("[logic/HIGH] other", "backend/x.ts"))).not.toBe(a);
});

test("a finding that came back after an earlier round holds the work", () => {
  const k = findingKey(f("[auth-smoke] sign-up did not create the account"));
  const v = judgeRound([round("live", [k], 20)], round("live", [k], 24), OPTS);
  expect(v.hold).toBe(true);
  if (v.hold) {
    expect(v.reason).toContain("came back");
    expect(v.evidence.join("\n")).toContain("sign-up did not create the account");
  }
});

test("new, different findings are normal progress and do not hold", () => {
  const v = judgeRound([round("live", [findingKey(f("[a] one"))], 20)], round("live", [findingKey(f("[b] two"))], 22), OPTS);
  expect(v.hold).toBe(false);
});

test("the same finding in a different stage is not a repeat", () => {
  const k = findingKey(f("[a] one"));
  expect(judgeRound([round("qa", [k], 5)], round("live", [k], 9), OPTS).hold).toBe(false);
});

test("a round that cost more than the cap without reducing the open findings holds the work", () => {
  const v = judgeRound([round("qa", [findingKey(f("[a] one"))], 10)], round("qa", [findingKey(f("[b] two"))], 19.5), OPTS);
  expect(v.hold).toBe(true);
  if (v.hold) expect(v.reason).toMatch(/\$9\.50/);
});

test("an expensive round that brought the findings down is progress", () => {
  const two = [findingKey(f("[a] one")), findingKey(f("[b] two"))];
  const v = judgeRound([round("qa", two, 10)], round("qa", [findingKey(f("[c] three"))], 25), OPTS);
  expect(v.hold).toBe(false);
});

test("the first round of a stage never holds", () => {
  expect(judgeRound([], round("live", [findingKey(f("[a] one"))], 30), OPTS).hold).toBe(false);
});

test("checkRoundGuard records every round, and on a hold writes a report the developer and Tilotma can read", async () => {
  setup();
  const spend = async () => 20;
  const first = await checkRoundGuard("p1", "live", [f("[auth-smoke] sign-up did not create the account")], { spend, opts: OPTS });
  expect(first.hold).toBe(false);
  const second = await checkRoundGuard("p1", "live", [f("[auth-smoke] sign-up did not create the account")], { spend: async () => 24, opts: OPTS });
  expect(second.hold).toBe(true);
  expect(readRounds("p1").length).toBe(2);
  const report = readFileSync(join(dir, "p1", "HOLD.md"), "utf-8");
  expect(report).toContain("came back");
  expect(report).toContain("$24.00");
  // Tilotma's evidence ledger gets it too
  expect(readFileSync(join(dir, "p1", "blockers.jsonl"), "utf-8")).toContain("guard");
});

test("no hold writes no report", async () => {
  setup();
  await checkRoundGuard("p1", "qa", [f("[a] one")], { spend: async () => 1, opts: OPTS });
  expect(existsSync(join(dir, "p1", "HOLD.md"))).toBe(false);
});

// Patent claim 6(c): when work is held because it keeps failing, the report points at approaches nobody has tried yet.
test("a hold report lists different approaches to try, leaving out any already tried for the project", async () => {
  const { recordAttempt, STRATEGY_LIBRARY } = await import("./strategies.ts");
  dir = mkdtempSync(join(tmpdir(), "guard-"));
  process.env.BUILD_DIR = dir;
  const f = (issue: string) => ({ file: "frontend/app/page.tsx", issue });
  const { buildDirFor } = await import("../../packages/agent-runtime/src/build-dir.ts");
  recordAttempt(buildDirFor("p9"), { stage: "live", findings: ["x"], strategyId: STRATEGY_LIBRARY[0]!.id, title: STRATEGY_LIBRARY[0]!.title });
  await checkRoundGuard("p9", "live", [f("[auth-smoke] same finding")], { spend: async () => 1, opts: { roundSpendCapUsd: 20 } });
  await checkRoundGuard("p9", "live", [f("[auth-smoke] same finding")], { spend: async () => 2, opts: { roundSpendCapUsd: 20 } });
  const report = readFileSync(join(buildDirFor("p9"), "HOLD.md"), "utf-8");
  expect(report).toContain("Different approaches to try");
  expect(report).not.toContain(STRATEGY_LIBRARY[0]!.title);
  expect(report).toContain(STRATEGY_LIBRARY[1]!.title);
});
