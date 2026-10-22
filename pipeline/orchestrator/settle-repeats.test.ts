import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 2026-10-22 (Trailhead rerun): the progress guard held the build on a finding that "came back" — a missing index on
// bookings(start_date, end_date) — although the index existed in db/migrations/0001_fix.sql. The guard's own note says a
// repeat is "either a failed fix or a false finding nobody disputed", but nothing checked which before holding. Now every
// repeated finding goes to the dispute settler first: one it finds not true is dropped (and remembered), and only what is
// still open is judged by the guard. A real repeat still holds.

let root: string;
const PID = "abc123def456";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "repeats-"));
  process.env.BUILD_DIR = root;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.BUILD_DIR;
});

async function projectDir(): Promise<string> {
  const { buildDirFor } = await import("../../packages/agent-runtime/src/build-dir.ts");
  const dir = buildDirFor(PID, root);
  (await import("node:fs")).mkdirSync(dir, { recursive: true });
  return dir;
}

const idx = { file: "db/migrations/0000_initial.sql", issue: "bookings has no index on start_date, end_date" };
const sql = { file: "backend/src/routes/bookings.ts", issue: "placeholders lack $ so values are inserted as literals" };

test("only findings already open in an earlier round of the same stage count as repeats", async () => {
  const dir = await projectDir();
  const { findingKey, repeatedFindings } = await import("./progress-guard.ts");
  writeFileSync(join(dir, "rounds.jsonl"), JSON.stringify({ at: "t", stage: "qa", findings: [findingKey(idx)], spendUsd: 1 }) + "\n" + JSON.stringify({ at: "t", stage: "live", findings: [findingKey(sql)], spendUsd: 2 }) + "\n");
  expect(repeatedFindings(PID, "qa", [idx, sql])).toEqual([idx]);
  expect(repeatedFindings(PID, "live", [idx, sql])).toEqual([sql]);
});

test("a repeat the settler finds not true is dropped and remembered; a true one stays", async () => {
  const dir = await projectDir();
  const { findingKey } = await import("./progress-guard.ts");
  writeFileSync(join(dir, "rounds.jsonl"), JSON.stringify({ at: "t", stage: "qa", findings: [findingKey(idx), findingKey(sql)], spendUsd: 1 }) + "\n");
  const { settleRepeatsBeforeGuard, dropSettledNotTrue } = await import("./disputes.ts");
  const asked: string[] = [];
  const kept = await settleRepeatsBeforeGuard(PID, "qa", [idx, sql], async (_pid, disputes) => {
    asked.push(...disputes.map((d) => d.finding));
    return disputes.map((d) => ({ dispute: d, verdict: d.finding.includes("index") ? "not_true" as const : "true" as const, evidence: "read the migrations" }));
  });
  expect(kept).toEqual([sql]);
  expect(asked).toHaveLength(2);
  // remembered: the same finding is dropped next time without asking again
  expect(dropSettledNotTrue(PID, [idx, sql]).kept).toEqual([sql]);
});

test("without a settler, or with no repeats, nothing is dropped", async () => {
  await projectDir();
  const { settleRepeatsBeforeGuard } = await import("./disputes.ts");
  expect(await settleRepeatsBeforeGuard(PID, "qa", [idx], undefined)).toEqual([idx]);
  let called = false;
  expect(await settleRepeatsBeforeGuard(PID, "qa", [idx], async () => { called = true; return []; })).toEqual([idx]);
  expect(called).toBe(false); // no earlier rounds, so no repeats to check
});

test("both review loops check repeats before the guard judges the round", () => {
  const qa = readFileSync(new URL("./stages/stage5-qa-fix-loop.ts", import.meta.url), "utf-8");
  const live = readFileSync(new URL("./stages/stage6-deployment.ts", import.meta.url), "utf-8");
  for (const src of [qa, live]) {
    const at = src.indexOf("settleRepeatsBeforeGuard(");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(src.indexOf("deps.roundGuard(", at - 2000) === -1 ? Infinity : src.indexOf("deps.roundGuard(", at));
  }
});
