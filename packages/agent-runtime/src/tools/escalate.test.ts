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
