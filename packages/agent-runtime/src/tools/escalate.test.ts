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

test("recordEscalation defaults an invalid target_agent to pranav rather than dropping the escalation", () => {
  const { escalation } = recordEscalation({ target_agent: "not-a-real-agent", finding: "x", reason: "y" });
  expect(escalation.targetAgent).toBe("pranav");
});
