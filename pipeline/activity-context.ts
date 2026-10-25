// Every activity runs inside its project's call context (2026-10-25, Amit: "a fully detailed costing and timing of each agent, each
// round"). Calls made outside an agent loop (the plan, the research, the design brief, the Chief AI check) used to carry no project or
// agent; now the activity's first argument (the project id) is attached to every call it makes, and the planning activities name the
// agent they are. The agent loops name themselves inside (their context is merged over this one).
import { withCallContext } from "../packages/llm-client/src/call-ledger.ts";

export const AGENT_OF_ACTIVITY: Record<string, string> = {
  runSaanvi: "saanvi",
  runArjun: "arjun",
  runPranav: "pranav",
  getDesignBrief: "vanya",
};

export function withActivityContext<T extends Record<string, unknown>>(activities: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(activities)) {
    if (typeof fn !== "function") {
      wrapped[name] = fn;
      continue;
    }
    wrapped[name] = (...args: any[]) =>
      withCallContext({ ...(typeof args[0] === "string" ? { projectId: args[0] } : {}), ...(AGENT_OF_ACTIVITY[name] ? { agent: AGENT_OF_ACTIVITY[name] } : {}) }, () => fn(...args));
  }
  return wrapped as T;
}
