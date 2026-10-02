import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockedActionTracker, isBlockedResult, BLOCKED_NOTICE_AT, BLOCKED_STOP_AT } from "./blocked-actions.ts";
import { recordBlocked, readBlockedReports, REPORT_BLOCKED_TOOL_DEF } from "./tools/blocked.ts";
import { buildToolList } from "./loop.ts";

// 2026-10-02 (Ledgerly benchmark run 2, approved by Amit): the frontend
// builder hit a blocked folder, a blocked command and an unreachable
// backend, then improvised for 42 steps — nothing noticed, and it had no
// way to report. A blocked agent now reports to Tilotma and carries on.

const refused = { status: "error" as const, summary: 'list_files failed: Error: Path traversal blocked: ".." escapes sandbox' };
const fine = { status: "success" as const, summary: "Wrote 120 chars to app/page.tsx" };

test("refusals for another folder, a disallowed command or denied file access count as blocked", () => {
  expect(isBlockedResult(refused)).toBe(true);
  expect(isBlockedResult({ status: "error", summary: "Command blocked: Command 'docker' is not in the allowlist" })).toBe(true);
  expect(isBlockedResult({ status: "error", summary: "'node peek.js' exited 1", output: "Error: Access to this API has been restricted\n code: 'ERR_ACCESS_DENIED'" })).toBe(true);
  expect(isBlockedResult({ status: "error", summary: "docker compose up refused: ../backend is outside your folder" })).toBe(true);
});

test("ordinary failures and successes are not blocked (a container still booting is not a wall)", () => {
  expect(isBlockedResult(fine)).toBe(false);
  expect(isBlockedResult({ status: "error", summary: "'npx next build' exited 1", output: "Type error: x is not assignable" })).toBe(false);
  expect(isBlockedResult({ status: "error", summary: "http_request failed: Error: Unable to connect. Is the computer able to access the url?" })).toBe(false);
});

test("the tracker warns at the notice threshold and stops at the stop threshold", () => {
  const t = new BlockedActionTracker();
  const notices: (string | null)[] = [];
  for (let i = 1; i <= BLOCKED_STOP_AT; i++) {
    t.observe(refused);
    t.observe(fine); // successes in between do not reset it
    notices.push(t.takeNotice());
    if (i < BLOCKED_STOP_AT) expect(t.shouldStop).toBe(false);
  }
  expect(notices[BLOCKED_NOTICE_AT - 1]).toContain("report_blocked");
  expect(notices.filter(Boolean).length).toBeGreaterThanOrEqual(1);
  expect(t.shouldStop).toBe(true);
  expect(t.count).toBe(BLOCKED_STOP_AT);
});

test("report_blocked records the report for Tilotma and tells the agent to carry on with its own work", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexsidi-blocked-"));
  const prev = process.env.BUILD_DIR;
  process.env.BUILD_DIR = dir;
  try {
    const r = recordBlocked("p1", "aanya", { owner: "shubham", what: "backend not reachable at localhost:3001", checked: "http_request to /api/v1/auth/sign-in" });
    expect(r.status).toBe("success");
    expect(r.summary).toContain("Tilotma");
    expect(r.summary.toLowerCase()).toContain("continue");
    const reports = readBlockedReports("p1");
    expect(reports.length).toBe(1);
    expect(reports[0]).toMatchObject({ agent: "aanya", owner: "shubham", what: "backend not reachable at localhost:3001" });
    expect(readFileSync(join(dir, "p1", "blockers.jsonl"), "utf-8").trim().split("\n").length).toBe(1);
    // an unknown owner goes to Tilotma rather than being dropped
    recordBlocked("p1", "aanya", { owner: "someone", what: "x", checked: "y" });
    expect(readBlockedReports("p1")[1]!.owner).toBe("tilotma");
  } finally {
    if (prev === undefined) delete process.env.BUILD_DIR; else process.env.BUILD_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every agent gets report_blocked, in every stage", () => {
  const base = { agentName: "aanya", model: "m", apiKey: "", systemPrompt: "", initialMessage: "", sandboxDir: "." } as unknown as Parameters<typeof buildToolList>[0];
  for (const config of [base, { ...base, readOnly: true }, { ...base, agentName: "shubham", enableEscalation: true }]) {
    expect(buildToolList(config).map((t) => t.function.name)).toContain(REPORT_BLOCKED_TOOL_DEF.function.name);
  }
});

test("every agent loop handles report_blocked and feeds each tool result to the blocked-action tracker", () => {
  for (const file of ["loop.ts", "gemini-loop.ts", "claude-loop.ts"]) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect({ file, handles: source.includes('case "report_blocked"') }).toEqual({ file, handles: true });
    expect({ file, tracks: source.includes("blockedTracker.observe(") }).toEqual({ file, tracks: true });
    expect({ file, stops: source.includes("blockedTracker.shouldStop") }).toEqual({ file, stops: true });
  }
});
