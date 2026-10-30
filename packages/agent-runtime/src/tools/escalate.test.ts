import { test, expect } from "bun:test";
import { recordEscalation } from "./escalate.ts";

test("recordEscalation captures the target agent, finding, and reason", () => {
  const { escalation } = recordEscalation({
    target_agent: "pranav",
    finding: "TOCTOU race condition in createApplication",
    reason: "needs UNIQUE(user_id, property_id) on the applications table — application code alone cannot close this",
  });
  expect(escalation).toEqual({
    targetAgent: "pranav",
    finding: "TOCTOU race condition in createApplication",
    reason: "needs UNIQUE(user_id, property_id) on the applications table — application code alone cannot close this",
  });
});

test("recordEscalation returns a success ToolResult so the agent loop can continue", () => {
  const { result } = recordEscalation({ target_agent: "shubham", finding: "x", reason: "y" });
  expect(result.status).toBe("success");
});

// 2026-10-03 (evidence-only plan): an unknown target used to become
// "pranav" — a guess about who owns the fix. The agent is now told to name
// the owner, and nothing is recorded until it does.
test("recordEscalation refuses an unknown target and asks the agent to name the owner", () => {
  const { escalation, result } = recordEscalation({ target_agent: "not-a-real-agent", finding: "x", reason: "y" });
  expect(escalation).toBeNull();
  expect(result.status).toBe("error");
  expect(result.summary).toContain("shubham");
});

// 2026-10-30 (team plan, stage 4): a fix run may finish with a failing acceptance test only when it disputed the test or
// handed it to its owner. Hand-offs were kept only in the loop's memory, so the finish check could not see them; each one
// is now also written to <build>/escalations.jsonl.
import { mkdtempSync as mkdtemp4, rmSync as rm4 } from "node:fs";
import { tmpdir as tmp4 } from "node:os";
import { join as join4 } from "node:path";
import { saveEscalation, readEscalations } from "./escalate.ts";

test("a hand-off is kept on disk and read back by time", () => {
  const root = mkdtemp4(join4(tmp4(), "esc-"));
  const prev = process.env.BUILD_DIR;
  process.env.BUILD_DIR = root;
  try {
    saveEscalation("p1", "aanya", { targetAgent: "shubham", finding: "[acceptance AT-1-2 / SC2] sign-up", reason: "the API answers 500" });
    const all = readEscalations("p1");
    expect(all).toEqual([{ agent: "aanya", targetAgent: "shubham", finding: "[acceptance AT-1-2 / SC2] sign-up", reason: "the API answers 500", at: expect.any(String) }]);
    expect(readEscalations("p1", "2999-01-01T00:00:00Z")).toEqual([]);
    expect(readEscalations("missing")).toEqual([]);
  } finally {
    if (prev === undefined) delete process.env.BUILD_DIR;
    else process.env.BUILD_DIR = prev;
    rm4(root, { recursive: true, force: true });
  }
});
