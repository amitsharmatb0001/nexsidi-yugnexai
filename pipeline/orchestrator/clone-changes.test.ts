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
