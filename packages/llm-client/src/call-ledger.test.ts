import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordedCall, noteUsage, withCallContext, callLedgerPath, readCallLedger } from "./call-ledger.ts";

// 2026-10-25 (Amit: "a fully detailed costing and timing of each agent, each round, not an overview report"): the project's
// spend table only holds totals per agent and model, and several paths (the planning chat, Saanvi's research, Arjun, the Chief AI
// check) were not in it at all. Every Gemini call, successful or failed, is now written to one append-only ledger with its model,
// start and end time, tokens, cache hits, and the agent and project it belongs to, so cost and time can be reported per agent
// and per round from recorded facts.

const prev = process.env.BUILD_DIR;
let dir = "";
function ledger(): string {
  dir = mkdtempSync(join(tmpdir(), "ledger-"));
  process.env.BUILD_DIR = dir;
  process.env.NEXSIDI_CALL_LEDGER = "on"; // this test file opts in; no other test writes a ledger
  return dir;
}
afterEach(() => {
  delete process.env.NEXSIDI_CALL_LEDGER;
  if (prev === undefined) delete process.env.BUILD_DIR;
  else process.env.BUILD_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

test("a successful call is recorded with its model, time, tokens, cache hits and context", async () => {
  ledger();
  const out = await withCallContext({ projectId: "p1", agent: "navya", tier: "qa" }, () =>
    recordedCall("tools", "gemini-4-argon", async () => {
      await new Promise((r) => setTimeout(r, 15));
      noteUsage({ tokensIn: 60_000, tokensOut: 4_000, cachedIn: 12_000 });
      return "answer";
    }),
  );
  expect(out).toBe("answer");
  const rows = readCallLedger(callLedgerPath());
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatchObject({ kind: "tools", model: "gemini-4-argon", ok: true, projectId: "p1", agent: "navya", tier: "qa", tokensIn: 60_000, tokensOut: 4_000, cachedIn: 12_000 });
  expect(rows[0]!.ms).toBeGreaterThanOrEqual(10);
  expect(Date.parse(rows[0]!.at)).toBeGreaterThan(Date.parse(rows[0]!.startedAt));
});

test("a failed call is recorded with how long it waited and why, and the error still reaches the caller", async () => {
  ledger();
  await expect(
    withCallContext({ projectId: "p1", agent: "karan", tier: "qa" }, () =>
      recordedCall("tools", "gemini-3.8-flash", async () => {
        await new Promise((r) => setTimeout(r, 5));
        throw new Error("[Gemini gemini-3.8-flash] AbortError: The operation was aborted.");
      }),
    ),
  ).rejects.toThrow("AbortError");
  const rows = readCallLedger(callLedgerPath());
  expect(rows[0]).toMatchObject({ model: "gemini-3.8-flash", ok: false, agent: "karan" });
  expect(rows[0]!.error).toContain("AbortError");
  expect(rows[0]!.tokensIn).toBeUndefined();
});

test("a call outside any context is still recorded, without project or agent", async () => {
  ledger();
  await recordedCall("chat", "gemini-3.1-pro-preview", async () => "x");
  const rows = readCallLedger(callLedgerPath());
  expect(rows.length).toBe(1);
  expect(rows[0]!.projectId).toBeUndefined();
  expect(rows[0]!.agent).toBeUndefined();
});

test("two calls at once keep their own context and usage", async () => {
  ledger();
  await Promise.all([
    withCallContext({ projectId: "p", agent: "aanya" }, () => recordedCall("tools", "m1", async () => { await new Promise((r) => setTimeout(r, 20)); noteUsage({ tokensIn: 1, tokensOut: 1 }); })),
    withCallContext({ projectId: "p", agent: "shubham" }, () => recordedCall("tools", "m2", async () => { noteUsage({ tokensIn: 2, tokensOut: 2 }); })),
  ]);
  const rows = readCallLedger(callLedgerPath());
  expect(rows.find((r) => r.agent === "aanya")).toMatchObject({ model: "m1", tokensIn: 1 });
  expect(rows.find((r) => r.agent === "shubham")).toMatchObject({ model: "m2", tokensIn: 2 });
});

test("the ledger lives in the builds folder, and an unwritable ledger never breaks a call", async () => {
  ledger();
  expect(callLedgerPath()).toBe(join(dir, ".call-ledger.jsonl"));
  process.env.BUILD_DIR = join(dir, "no", "such", "\0bad");
  expect(await recordedCall("chat", "m", async () => "still works")).toBe("still works");
  expect(existsSync(join(dir, "no"))).toBe(false);
});

test("every Gemini call path of the client is recorded, and each agent loop sets its context", () => {
  const gemini = readFileSync(new URL("./gemini.ts", import.meta.url), "utf-8");
  expect((gemini.match(/recordedCall\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect((gemini.match(/noteUsage\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  const loop = readFileSync(new URL("../../agent-runtime/src/gemini-loop.ts", import.meta.url), "utf-8");
  expect(loop).toContain("withCallContext(");
  const qa = readFileSync(new URL("../../agent-runtime/src/qa-loop.ts", import.meta.url), "utf-8");
  expect(qa).toContain("withCallContext(");
});

// 2026-10-25: a test run's own Gemini calls (mostly failures with no project) were written into the real builds folder's ledger, next
// to a real build's rows. Under `bun test` nothing is written unless the test sets its own folder.
test("under a test run nothing is written to the real builds folder, even though .env sets BUILD_DIR", async () => {
  const saved = { b: process.env.BUILD_DIR, n: process.env.NODE_ENV, l: process.env.NEXSIDI_CALL_LEDGER };
  process.env.BUILD_DIR = mkdtempSync(join(tmpdir(), "ledger-real-"));
  delete process.env.NEXSIDI_CALL_LEDGER;
  process.env.NODE_ENV = "test";
  try {
    await recordedCall("chat", "gemini-3.5-flash", async () => "x");
    expect(existsSync(callLedgerPath())).toBe(false);
  } finally {
    rmSync(process.env.BUILD_DIR!, { recursive: true, force: true });
    if (saved.b === undefined) delete process.env.BUILD_DIR; else process.env.BUILD_DIR = saved.b;
    if (saved.n === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.n;
    if (saved.l === undefined) delete process.env.NEXSIDI_CALL_LEDGER; else process.env.NEXSIDI_CALL_LEDGER = saved.l;
  }
});
