import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listLabeledFiles,
  resolveLabeledFile,
  readLabeledFiles,
  readLabeledFile,
  detectStuckLoop,
  buildQaInitialMessage,
  computeQaMaxIterations,
  stripThinkingBlock,
  extractFindingsFromHistory,
  sharedFileReadCache,
  clearSharedFileReadCache,
  isQaReadCacheEnabled,
  type LabeledDir,
} from "./qa-loop.ts";

let root: string;
let dirs: LabeledDir[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexsidi-qa-loop-test-"));
  const backend = join(root, "backend");
  const frontend = join(root, "frontend");
  mkdirSync(join(backend, "src", "controllers"), { recursive: true });
  mkdirSync(join(backend, "node_modules", "somepkg"), { recursive: true });
  mkdirSync(join(frontend, "app"), { recursive: true });

  writeFileSync(join(backend, "src", "controllers", "tasks.ts"), "export const x = 1;");
  writeFileSync(join(backend, "src", "index.ts"), "export {};");
  writeFileSync(join(backend, "node_modules", "somepkg", "index.js"), "module.exports = {};");
  writeFileSync(join(backend, "package-lock.json"), "{}"); // .json IS a code extension — should be listed
  writeFileSync(join(backend, "logo.png"), "binary"); // not a code extension — should be skipped
  writeFileSync(join(frontend, "app", "page.tsx"), "export default function Page() {}");

  dirs = [
    { label: "backend", path: backend },
    { label: "frontend", path: frontend },
  ];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// 2026-07-26 (agent-autonomy-assessment F5): QA agents (Navya/Karan/
// Deepika) previously reviewed code with NO spec, NO API contract, NO DB
// schema — only the code itself and a "review for X" instruction. Live
// proof of the cost: with no scale/deployment context, QA re-flagged the
// same missing-DB-index "finding" as HIGH on every single round of a real
// 6-round run, and the debate step had to re-discover and re-discard it as
// a false positive every time — a whole QA agent's budget spent rediscovering
// the same non-bug. Worse, QA structurally cannot report "this doesn't match
// what the user asked for" without ever seeing what was asked for.
// buildQaInitialMessage is the pure, testable core of the message
// injecting system context — mirrors buildFixTask's split in
// Shubham/Aanya.
test("buildQaInitialMessage includes the system context ahead of the review instruction", () => {
  const msg = buildQaInitialMessage("logic errors", "SYSTEM YOU ARE WORKING ON:\nGreenway Estates Portal");
  expect(msg).toContain("Greenway Estates Portal");
  expect(msg).toContain("logic errors");
  expect(msg.indexOf("Greenway Estates Portal")).toBeLessThan(msg.indexOf("Review this codebase"));
});

test("buildQaInitialMessage works with no system context (backward compatible)", () => {
  const msg = buildQaInitialMessage("logic errors", undefined);
  expect(msg).toContain("Review this codebase for logic errors");
});

// 2026-08-03: real cost problem found live — a single QA round hit ~7.8M
// tokens because read_file is one-file-per-call and every call resends the
// full growing history. buildQaInitialMessage now steers agents toward
// read_files (batched) instead of read_file one at a time.
test("buildQaInitialMessage tells the agent to batch reads via read_files", () => {
  const msg = buildQaInitialMessage("logic errors", undefined);
  expect(msg).toContain("read_files");
  expect(msg).toContain("batch");
});

// ── readLabeledFiles (batch read) ───────────────────────────────────────────
test("readLabeledFiles reads multiple files in one call and reports which were actually read", () => {
  const { output, readPaths } = readLabeledFiles(dirs, ["backend/src/index.ts", "frontend/app/page.tsx"]);
  expect(readPaths).toEqual(["backend/src/index.ts", "frontend/app/page.tsx"]);
  expect(output).toContain("// FILE: backend/src/index.ts");
  expect(output).toContain("export {};");
  expect(output).toContain("// FILE: frontend/app/page.tsx");
  expect(output).toContain("export default function Page() {}");
});

test("readLabeledFiles reports a missing file inline instead of failing the whole batch", () => {
  const { output, readPaths } = readLabeledFiles(dirs, ["backend/src/index.ts", "backend/does-not-exist.ts"]);
  expect(readPaths).toEqual(["backend/src/index.ts"]); // only the real file counts toward coverage
  expect(output).toContain("// FILE: backend/does-not-exist.ts");
  expect(output).toContain("not found");
});

test("readLabeledFiles returns an empty result for an empty path list", () => {
  const { output, readPaths } = readLabeledFiles(dirs, []);
  expect(readPaths).toEqual([]);
  expect(output).toBe("");
});

// 2026-07-26 (agent-autonomy-assessment root-cause, follow-on): full
// coverage (finding-evidence.ts's checkReviewCoverage) now requires
// reading EVERY listed file — a fixed 30-iteration cap made that
// structurally impossible on a real-size project (complex1 had 84
// reviewable files; one read_file per iteration alone exceeds 30 before
// list_files or submit_findings ever run). The cap must scale with what
// full coverage actually costs: one iteration per file read, plus
// list_files, submit_findings, and slack for a few non-read turns.
test("computeQaMaxIterations scales past the old fixed cap for a real-size project", () => {
  expect(computeQaMaxIterations(84)).toBeGreaterThan(84);
});

// 2026-08-05 (live, project 09bf2f89ca43): the fallback findings-extraction
// call replays the ORIGINAL QA agent's system prompt (which mandates
// core-reasoning.md's Rule 0 <thinking> block) even though its own new
// instruction says "no formatting, output only JSON" — the model wraps the
// JSON in a thinking block anyway, and JSON.parse threw on the leading "<",
// silently dropping real findings via the catch block's `return []`.
test("stripThinkingBlock removes a leading thinking block before JSON content", () => {
  const raw = "<thinking>\nThe agent found 2 issues, let me format them.\n</thinking>\n{\"findings\": []}";
  expect(stripThinkingBlock(raw)).toBe('{"findings": []}');
});

test("stripThinkingBlock leaves plain JSON (no thinking block) unchanged", () => {
  const raw = '{"findings": [{"severity": "HIGH"}]}';
  expect(stripThinkingBlock(raw)).toBe(raw);
});

test("stripThinkingBlock only strips a LEADING thinking block, not one embedded mid-string", () => {
  const raw = '{"findings": [{"detail": "mentions <thinking> literally in the text"}]}';
  expect(stripThinkingBlock(raw)).toBe(raw);
});

// 2026-08-06: real bug found live (project 88d7b375eaef) — Karan's fallback
// extraction hit "SyntaxError: JSON Parse error: Unexpected EOF" (a genuinely
// truncated LLM response, not the <thinking>-wrapping case above) and the old
// catch block silently returned [], indistinguishable from "reviewed cleanly,
// no findings." extractFindingsFromHistory now retries once, and on a second
// failure pushes into the caller-supplied `errors` array instead of
// swallowing — Navya/Karan/Deepika's existing hasFatalError check turns any
// non-benign errors[] entry into a synthetic "review did not complete"
// finding, so a real extraction failure now blocks the QA gate instead of
// silently passing it.
// Dependency-injected stub (matches this codebase's own convention — see
// Vanya's `deps: VanyaDeps = { chat: agentChat }`) rather than mock.module,
// which registers globally for the whole bun test process and leaked into
// packages/llm-client/src/gemini.test.ts's own direct-import test for the
// real geminiChat — a real bug found while first writing this test.
function stubChat(responses: string[]): { chat: (msgs: unknown[]) => Promise<{ content: string }>; callCount: () => number } {
  let calls = 0;
  return {
    chat: async () => {
      const content = responses[calls] ?? responses.at(-1) ?? "";
      calls++;
      return { content };
    },
    callCount: () => calls,
  };
}

test("extractFindingsFromHistory retries once on unparseable content, then succeeds", async () => {
  const { chat, callCount } = stubChat(["not valid json{{{", '{"findings": [{"severity": "HIGH", "category": "x", "detail": "y", "file": "backend/src/index.ts"}]}']);
  const errors: string[] = [];
  const findings = await extractFindingsFromHistory(
    [{ role: "user", content: "review this" } as any],
    "karan",
    new Set(["backend/src/index.ts"]),
    errors,
    chat as any,
  );
  expect(callCount()).toBe(2);
  expect(findings).toHaveLength(1);
  expect(errors).toHaveLength(0);
});

test("extractFindingsFromHistory pushes a non-benign error (not silent []) when both attempts are unparseable", async () => {
  const { chat, callCount } = stubChat(["not valid json{{{", "still not valid json{{{"]);
  const errors: string[] = [];
  const findings = await extractFindingsFromHistory(
    [{ role: "user", content: "review this" } as any],
    "karan",
    new Set(["backend/src/index.ts"]),
    errors,
    chat as any,
  );
  expect(callCount()).toBe(2);
  expect(findings).toEqual([]);
  expect(errors).toHaveLength(1);
  // Must NOT match the benign-pattern excludes karan/navya/deepika's wrappers
  // check for, or a real failure would still be misread as a clean pass.
  expect(errors[0]).not.toContain("Max iterations");
  expect(errors[0]).not.toContain("stopped without calling submit_findings");
  expect(errors[0]).not.toContain("Stuck:");
});

test("computeQaMaxIterations never drops below the original 30 for small projects", () => {
  expect(computeQaMaxIterations(5)).toBeGreaterThanOrEqual(30);
  expect(computeQaMaxIterations(0)).toBeGreaterThanOrEqual(30);
});

test("listLabeledFiles prefixes every file with its label", () => {
  const files = listLabeledFiles(dirs);
  expect(files).toContain("backend/src/controllers/tasks.ts");
  expect(files).toContain("backend/src/index.ts");
  expect(files).toContain("frontend/app/page.tsx");
});

test("listLabeledFiles skips node_modules", () => {
  const files = listLabeledFiles(dirs);
  expect(files.some((f) => f.includes("node_modules"))).toBe(false);
});

test("listLabeledFiles skips non-code extensions", () => {
  const files = listLabeledFiles(dirs);
  expect(files.some((f) => f.endsWith("logo.png"))).toBe(false);
});

test("listLabeledFiles includes recognized code extensions like .json", () => {
  const files = listLabeledFiles(dirs);
  expect(files).toContain("backend/package-lock.json");
});

// 2026-07-28 (live, complex1): real bug found live — a generated frontend's
// vendored NexUI library (frontend/vendor/nexui + nexui-react, per CLAUDE.md
// "vendored into the generated app's own output dir — no external npm
// dependency") is STATIC, identical across every project and every QA round,
// and not code Navya/Karan/Deepika can find a fixable bug in (Shubham/Aanya
// don't own it either). Counted live on complex1: 200 vendor files vs only
// 30 real generated frontend files — RC-2's full-coverage requirement
// (checkReviewCoverage) forced all 3 QA agents to re-read all 200 vendor
// files on EVERY retest round, the dominant cost behind a 35+ minute
// live-retest wall-clock. Excluding it doesn't weaken full coverage of the
// actual generated app code RC-2 was protecting — vendor/ never changes and
// was never the thing a QA round could have found a real regression in.
test("listLabeledFiles skips a vendored (vendor/) directory", () => {
  mkdirSync(join(root, "frontend", "vendor", "nexui", "src"), { recursive: true });
  writeFileSync(join(root, "frontend", "vendor", "nexui", "src", "button.ts"), "export {};");

  const files = listLabeledFiles(dirs);

  expect(files.some((f) => f.includes("vendor"))).toBe(false);
});

test("listLabeledFiles tolerates a directory that doesn't exist yet", () => {
  const files = listLabeledFiles([{ label: "ghost", path: join(root, "does-not-exist") }]);
  expect(files).toEqual([]);
});

test("resolveLabeledFile maps a labeled path back to its real filesystem path", () => {
  const abs = resolveLabeledFile(dirs, "backend/src/controllers/tasks.ts");
  expect(abs).toBe(join(root, "backend", "src", "controllers", "tasks.ts"));
});

test("resolveLabeledFile returns null for a path with no matching label prefix", () => {
  expect(resolveLabeledFile(dirs, "unknown-area/x.ts")).toBeNull();
});

test("resolveLabeledFile picks the correct dir when multiple labels are present", () => {
  expect(resolveLabeledFile(dirs, "frontend/app/page.tsx")).toBe(join(root, "frontend", "app", "page.tsx"));
});

// 2026-07-12: real bug found live — Navya called read_file on the identical
// path 20 times in a row, burning the full 30-iteration budget before
// falling through to a vague "Max iterations reached" message. detectStuckLoop
// is the pure check the loop uses to exit early with a clear diagnostic.
test("detectStuckLoop is false when fewer signatures than the threshold have accumulated", () => {
  expect(detectStuckLoop(["read_file:a", "read_file:a"], 3)).toBe(false);
});

test("detectStuckLoop is true when the last N signatures are all identical", () => {
  expect(detectStuckLoop(["list_files:{}", "read_file:a", "read_file:a", "read_file:a"], 3)).toBe(true);
});

test("detectStuckLoop is false when the last N signatures include any variation", () => {
  expect(detectStuckLoop(["read_file:a", "read_file:b", "read_file:a"], 3)).toBe(false);
});

test("detectStuckLoop only looks at the trailing window, not the whole history", () => {
  // 3 identical calls happened early, then the agent moved on — not currently stuck.
  expect(detectStuckLoop(["read_file:a", "read_file:a", "read_file:a", "read_file:b", "read_file:c"], 3)).toBe(false);
});

// ── Shared QA file-read cache (cost-control plan Task 3) ────────────────────
// 2026-08-11: real cost problem confirmed live — Navya/Karan/Deepika each run
// runQAAgent() independently (see stage5-adversarial-qa.ts's
// runStage5WithAgents, which dispatches all three via Promise.all against the
// SAME projectId/dirs/code state) and each one's read_file/read_files tool
// handler called readFileSync directly with zero shared state — confirmed by
// reading qa-loop.ts's read_file/read_files switch cases and readLabeledFiles:
// no cache existed anywhere before this test, so three reviewers reading the
// same file in the same round meant three real disk reads + three full
// re-serializations of that content into the tool result. sharedFileReadCache
// gives all three the same FileReadCache instance for a given projectId; the
// first reviewer's read is real, the second and third are served from the
// cache's in-memory entry instead.
test("three QA-agent-shaped reads against the same fixture project hit disk once per unique file, not three times", () => {
  const cache = sharedFileReadCache("dedup-fixture-project");
  cache.clear(); // isolate from any other test reusing this projectId

  const filesEachReviewerReads = [
    "backend/src/index.ts",
    "backend/src/controllers/tasks.ts",
    "frontend/app/page.tsx",
  ];
  const reviewers = ["navya", "karan", "deepika"];

  for (const _reviewer of reviewers) {
    for (const path of filesEachReviewerReads) {
      // readLabeledFile is the exact function qa-loop.ts's read_file tool
      // handler calls — this exercises the real dedup path, not a proxy.
      const { found } = readLabeledFile(dirs, path, cache);
      expect(found).toBe(true);
    }
  }

  // 3 reviewers x 3 files = 9 tool-call-shaped reads, but only 3 unique
  // files — the underlying disk read must happen exactly once per file.
  expect(cache.realReadCount).toBe(filesEachReviewerReads.length);
});

test("sharedFileReadCache also dedupes the batched read_files path (readLabeledFiles), not just single read_file", () => {
  const cache = sharedFileReadCache("dedup-fixture-project-batch");
  cache.clear();

  const paths = ["backend/src/index.ts", "frontend/app/page.tsx"];
  // Navya batches both files in one read_files call...
  readLabeledFiles(dirs, paths, cache);
  // ...Karan requests the same batch...
  readLabeledFiles(dirs, paths, cache);
  // ...Deepika requests the same batch, and content must still be correct.
  const { output } = readLabeledFiles(dirs, paths, cache);

  expect(cache.realReadCount).toBe(paths.length);
  expect(output).toContain("export {};");
  expect(output).toContain("export default function Page() {}");
});

test("FileReadCache without a cache argument (undefined) falls back to a real read every time — backward compatible / cache is opt-in per call", () => {
  // No cache passed — mirrors every EXISTING caller (all prior tests in this
  // file call readLabeledFiles/readLabeledFile with no third argument), so
  // this proves the dedup feature is additive and doesn't change behavior
  // for a caller that doesn't opt in.
  const first = readLabeledFile(dirs, "backend/src/index.ts");
  const second = readLabeledFile(dirs, "backend/src/index.ts");
  expect(first.found).toBe(true);
  expect(second.found).toBe(true);
  expect(first.content).toBe(second.content);
});

test("readLabeledFile reports not-found the same way with or without a cache", () => {
  expect(readLabeledFile(dirs, "backend/does-not-exist.ts").found).toBe(false);
  const cache = sharedFileReadCache("dedup-not-found-project");
  cache.clear();
  expect(readLabeledFile(dirs, "backend/does-not-exist.ts", cache).found).toBe(false);
});

// Round boundary: files change between fix passes (qa-fix-loop.ts re-runs
// Stage 5 up to 5x per project), so a round N+1 reviewer must never be served
// round N's stale cached content.
test("clearSharedFileReadCache forces a fresh disk read on the next QA round instead of serving stale content", () => {
  const projectId = "dedup-round-clear-project";
  const before = sharedFileReadCache(projectId);
  before.clear();

  const first = readLabeledFile(dirs, "backend/src/index.ts", before);
  expect(first.content).toContain("export {};");
  expect(before.realReadCount).toBe(1);

  // A fix pass changes the file's content between rounds.
  writeFileSync(join(root, "backend", "src", "index.ts"), "export const changed = true;");

  clearSharedFileReadCache(projectId);
  const after = sharedFileReadCache(projectId);
  const second = readLabeledFile(dirs, "backend/src/index.ts", after);

  expect(second.content).toContain("changed");
  expect(after.realReadCount).toBe(1); // fresh cache after clear — one real read, not a stale hit
});

test("clearSharedFileReadCache on a projectId with no existing cache is a safe no-op", () => {
  expect(() => clearSharedFileReadCache("never-seen-this-project-id")).not.toThrow();
});

// Global constraint from the cost-control plan: every lever must be
// individually toggleable/revertable. QA_READ_CACHE_ENABLED=false reverts to
// the pre-existing independent-read behavior without a code change, matching
// the PROMPT_AUDIT_ENABLED convention (packages/prompt-audit/src/index.ts).
test("isQaReadCacheEnabled defaults to enabled and can be disabled via QA_READ_CACHE_ENABLED=false", () => {
  const original = process.env.QA_READ_CACHE_ENABLED;
  try {
    delete process.env.QA_READ_CACHE_ENABLED;
    expect(isQaReadCacheEnabled()).toBe(true);

    process.env.QA_READ_CACHE_ENABLED = "false";
    expect(isQaReadCacheEnabled()).toBe(false);

    process.env.QA_READ_CACHE_ENABLED = "true";
    expect(isQaReadCacheEnabled()).toBe(true);
  } finally {
    if (original === undefined) delete process.env.QA_READ_CACHE_ENABLED;
    else process.env.QA_READ_CACHE_ENABLED = original;
  }
});
