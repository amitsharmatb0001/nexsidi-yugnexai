import { test, expect } from "bun:test";
import { join } from "node:path";
import type { AgentRunConfig, AgentRunResult } from "../../packages/agent-runtime/src/loop.ts";
import { applyCloneChanges, buildCloneEditTask, CLONE_EDIT_SYSTEM_PROMPT } from "./clone-changes.ts";

// ── buildCloneEditTask (pure) ────────────────────────────────────────────
test("buildCloneEditTask includes the exact change request and the clone's new name", () => {
  const task = buildCloneEditTask("swap the 3 services for Consulting, Training, and Support", "Beacon Labs");
  expect(task).toContain("swap the 3 services for Consulting, Training, and Support");
  expect(task).toContain("Beacon Labs");
});

test("buildCloneEditTask includes real backend context when a backend pass just ran, so the frontend wires to what actually exists", () => {
  const task = buildCloneEditTask("add a wishlist page", "DropCircle", "Added GET/POST /api/v1/wishlist");
  expect(task).toContain("Added GET/POST /api/v1/wishlist");
});

test("buildCloneEditTask omits the backend section entirely when no backend context is given — the common, cheaper case", () => {
  const task = buildCloneEditTask("reword the hero", "DropCircle");
  expect(task).not.toContain("backend was just updated");
});

test("CLONE_EDIT_SYSTEM_PROMPT tells the agent to check middleware.ts's public-paths allowlist when adding a new public page — real bug found live: a new /case-studies page silently redirected to sign-in", () => {
  expect(CLONE_EDIT_SYSTEM_PROMPT).toContain("middleware.ts");
  expect(CLONE_EDIT_SYSTEM_PROMPT.toLowerCase()).toContain("public");
});

// ── CLONE_EDIT_SYSTEM_PROMPT ─────────────────────────────────────────────
test("CLONE_EDIT_SYSTEM_PROMPT tells the agent this is an already-working app, not a fresh build", () => {
  expect(CLONE_EDIT_SYSTEM_PROMPT).toMatch(/already.working|already.delivered/i);
});

test("CLONE_EDIT_SYSTEM_PROMPT restricts the agent to only the requested changes", () => {
  expect(CLONE_EDIT_SYSTEM_PROMPT).toMatch(/only|ONLY/);
  expect(CLONE_EDIT_SYSTEM_PROMPT.toLowerCase()).toContain("nothing else");
});

test("CLONE_EDIT_SYSTEM_PROMPT tells the agent to install dependencies first — node_modules is never copied by cloneProject", () => {
  expect(CLONE_EDIT_SYSTEM_PROMPT).toContain("npm install");
});

// ── applyCloneChanges — real logic, fake injected runner ────────────────
function makeFakeRunner(capture: { config: AgentRunConfig | null }, response: AgentRunResult & { escalated: boolean }) {
  return async (config: AgentRunConfig) => {
    capture.config = config;
    return response;
  };
}

test("applyCloneChanges scopes the agent's sandboxDir to the clone's frontend directory, not the project root", async () => {
  const capture: { config: AgentRunConfig | null } = { config: null };
  const runGenerator = makeFakeRunner(capture, {
    success: true, summary: "done", filesWritten: [], iterations: 1, errors: [], escalated: false,
  });

  await applyCloneChanges(
    { buildDir: join("E:", "tmp", "nexsidi-builds", "clone1"), changes: "change the hero tagline", newName: "Beacon Labs", apiKey: "test-key" },
    { runGenerator },
  );

  expect(capture.config).not.toBeNull();
  expect(capture.config!.sandboxDir).toBe(join("E:", "tmp", "nexsidi-builds", "clone1", "frontend"));
});

test("applyCloneChanges passes the change request and new name into the agent's initial message", async () => {
  const capture: { config: AgentRunConfig | null } = { config: null };
  const runGenerator = makeFakeRunner(capture, {
    success: true, summary: "done", filesWritten: [], iterations: 1, errors: [], escalated: false,
  });

  await applyCloneChanges(
    { buildDir: join("E:", "tmp", "nexsidi-builds", "clone1"), changes: "recolor the accent to forest green", newName: "Beacon Labs", apiKey: "test-key" },
    { runGenerator },
  );

  expect(capture.config!.initialMessage).toContain("recolor the accent to forest green");
  expect(capture.config!.initialMessage).toContain("Beacon Labs");
});

test("applyCloneChanges requires a real build to pass before the agent can finish — not just a claim", async () => {
  const capture: { config: AgentRunConfig | null } = { config: null };
  const runGenerator = makeFakeRunner(capture, {
    success: true, summary: "done", filesWritten: [], iterations: 1, errors: [], escalated: false,
  });

  await applyCloneChanges(
    { buildDir: join("E:", "tmp", "nexsidi-builds", "clone1"), changes: "x", newName: "Beacon Labs", apiKey: "test-key" },
    { runGenerator },
  );

  expect(capture.config!.requiredVerificationCommands).toContain("npx next build");
});

test("applyCloneChanges uses a bounded iteration cap sized for a scoped edit, not a full generation run", async () => {
  const capture: { config: AgentRunConfig | null } = { config: null };
  const runGenerator = makeFakeRunner(capture, {
    success: true, summary: "done", filesWritten: [], iterations: 1, errors: [], escalated: false,
  });

  await applyCloneChanges(
    { buildDir: join("E:", "tmp", "nexsidi-builds", "clone1"), changes: "x", newName: "Beacon Labs", apiKey: "test-key" },
    { runGenerator },
  );

  expect(capture.config!.maxIterations).toBeGreaterThan(0);
  expect(capture.config!.maxIterations).toBeLessThanOrEqual(40);
});

test("applyCloneChanges raises the iteration budget when wiring to a backend that just changed — a bigger task than a plain content edit", async () => {
  const capture: { config: AgentRunConfig | null } = { config: null };
  const runGenerator = makeFakeRunner(capture, {
    success: true, summary: "done", filesWritten: [], iterations: 1, errors: [], escalated: false,
  });

  await applyCloneChanges(
    { buildDir: join("E:", "tmp", "nexsidi-builds", "clone1"), changes: "x", newName: "Beacon Labs", apiKey: "test-key", backendContext: "Added GET /api/v1/wishlist" },
    { runGenerator },
  );

  expect(capture.config!.maxIterations).toBeGreaterThan(25);
});

test("applyCloneChanges reports applied:true and the real files touched when the agent succeeds", async () => {
  const runGenerator = async () => ({
    success: true, summary: "Changed 3 service names in components/Services.tsx", filesWritten: ["components/Services.tsx"], iterations: 4, errors: [], escalated: false,
  });

  const result = await applyCloneChanges(
    { buildDir: join("E:", "tmp", "nexsidi-builds", "clone1"), changes: "x", newName: "Beacon Labs", apiKey: "test-key" },
    { runGenerator },
  );

  expect(result.applied).toBe(true);
  expect(result.filesWritten).toEqual(["components/Services.tsx"]);
  expect(result.summary).toContain("Services.tsx");
});

test("applyCloneChanges reports applied:false and surfaces errors when the agent can't finish", async () => {
  const runGenerator = async () => ({
    success: false, summary: "Max iterations reached", filesWritten: [], iterations: 25, errors: ["Max iterations exceeded"], escalated: true,
  });

  const result = await applyCloneChanges(
    { buildDir: join("E:", "tmp", "nexsidi-builds", "clone1"), changes: "x", newName: "Beacon Labs", apiKey: "test-key" },
    { runGenerator },
  );

  expect(result.applied).toBe(false);
  expect(result.errors).toContain("Max iterations exceeded");
});

// ── 2026-10-13 (Shopbill run 3): a pass that runs out of iterations with a failing check ─────────────
// The editor spent 40 iterations (six of them re-reading one file in 2000-character slices) and stopped one type
// error short. The route went on to deploy and Docker's build found the error six minutes later.
test("CLONE_EDIT_SYSTEM_PROMPT tells the agent to read a file whole, not in small slices", () => {
  expect(CLONE_EDIT_SYSTEM_PROMPT.toLowerCase()).toContain("whole");
  expect(CLONE_EDIT_SYSTEM_PROMPT).toContain("limit");
});

test("applyCloneChanges does not run its own check, or send the agent back, when the pass already finished with its checks green", async () => {
  let runs = 0;
  let verifies = 0;
  const runGenerator = async () => {
    runs += 1;
    return { success: true, summary: "done", filesWritten: ["app/page.tsx"], iterations: 10, errors: [], escalated: false };
  };
  const verify = async () => {
    verifies += 1;
    return { ran: true, ok: true, output: "" };
  };
  const r = await applyCloneChanges({ buildDir: join("E:", "tmp", "x", "clone1"), changes: "c", newName: "N", apiKey: "k" }, { runGenerator, verify });
  expect(r.applied).toBe(true);
  expect(runs).toBe(1);
  expect(verifies).toBe(0);
});

test("applyCloneChanges, when the pass ends with failing checks, reads the real errors and sends the agent back once with exactly those", async () => {
  const messages: string[] = [];
  let call = 0;
  const runGenerator = async (config: AgentRunConfig) => {
    call += 1;
    messages.push(config.initialMessage);
    return call === 1
      ? { success: false, summary: "ran out", filesWritten: ["app/pricing/page.tsx"], iterations: 40, errors: ["required verification command(s) did not exit 0"], escalated: false }
      : { success: true, summary: "fixed", filesWritten: ["app/pricing/page.tsx"], iterations: 3, errors: [], escalated: false };
  };
  const outputs = [
    { ran: true, ok: false, output: "app/pricing/page.tsx(192,19): error TS2322: Type 'secondary' is not assignable" },
    { ran: true, ok: true, output: "" },
  ];
  const verify = async () => outputs.shift()!;
  const r = await applyCloneChanges({ buildDir: join("E:", "tmp", "x", "clone1"), changes: "c", newName: "N", apiKey: "k" }, { runGenerator, verify });
  expect(call).toBe(2);
  expect(messages[1]).toContain("app/pricing/page.tsx(192,19)");
  expect(r.applied).toBe(true);
  expect(r.filesWritten).toContain("app/pricing/page.tsx");
});

test("applyCloneChanges fails the pass, with the real error text, when the one fix-up does not make the checks pass", async () => {
  const runGenerator = async () => ({ success: false, summary: "ran out", filesWritten: [], iterations: 40, errors: ["ran out"], escalated: false });
  const verify = async () => ({ ran: true, ok: false, output: "app/x.tsx(1,1): error TS1005: ';' expected" });
  const r = await applyCloneChanges({ buildDir: join("E:", "tmp", "x", "clone1"), changes: "c", newName: "N", apiKey: "k" }, { runGenerator, verify });
  expect(r.applied).toBe(false);
  expect(r.errors.join(" ")).toContain("error TS1005");
});

test("applyCloneChanges, when its own check cannot run, leaves the pass's own failure as it is — no fix-up on a guess", async () => {
  let runs = 0;
  const runGenerator = async () => {
    runs += 1;
    return { success: false, summary: "ran out", filesWritten: [], iterations: 40, errors: ["ran out"], escalated: false };
  };
  const verify = async () => ({ ran: false, ok: false, output: "" });
  const r = await applyCloneChanges({ buildDir: join("E:", "tmp", "x", "clone1"), changes: "c", newName: "N", apiKey: "k" }, { runGenerator, verify });
  expect(runs).toBe(1);
  expect(r.applied).toBe(false);
});
