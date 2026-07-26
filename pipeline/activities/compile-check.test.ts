import { expect, test } from "bun:test";

test("uses Windows command shims for npm and npx", async () => {
  const activities = await import("./index.ts") as Record<string, unknown>;
  const resolveNodeCommand = activities.resolveNodeCommand as
    | ((command: "npm" | "npx", platform: NodeJS.Platform) => string)
    | undefined;

  expect(typeof resolveNodeCommand).toBe("function");
  expect(resolveNodeCommand?.("npm", "win32")).toBe("npm.cmd");
  expect(resolveNodeCommand?.("npx", "win32")).toBe("npx.cmd");
  expect(resolveNodeCommand?.("npm", "linux")).toBe("npm");
});

test("reports child-process spawn errors when stderr is empty", async () => {
  const activities = await import("./index.ts") as Record<string, unknown>;
  const describeCommandFailure = activities.describeCommandFailure as
    | ((result: {
        status: number | null;
        signal: NodeJS.Signals | null;
        stdout: string;
        stderr: string;
        error?: Error;
      }) => string)
    | undefined;

  expect(typeof describeCommandFailure).toBe("function");
  expect(describeCommandFailure?.({
    status: null,
    signal: null,
    stdout: "",
    stderr: "",
    error: new Error("ENOENT: uv_spawn 'npm'"),
  })).toContain("ENOENT: uv_spawn 'npm'");
});

test("routes a frontend-only compile failure only to frontend repair", async () => {
  const activities = await import("./index.ts") as Record<string, unknown>;
  const selectRepairTargets = activities.selectRepairTargets as
    | ((reason: string) => string[])
    | undefined;

  expect(typeof selectRepairTargets).toBe("function");
  expect(selectRepairTargets?.("compile_error:\nfrontend: tsc exit 2\napp/page.tsx(1,1): error TS7006")).toEqual(["frontend"]);
});

test("routes backend-only and mixed compile failures to the affected generators", async () => {
  const activities = await import("./index.ts") as Record<string, unknown>;
  const selectRepairTargets = activities.selectRepairTargets as
    | ((reason: string) => string[])
    | undefined;

  expect(selectRepairTargets?.("compile_error:\nbackend: tsc exit 2")).toEqual(["backend"]);
  expect(selectRepairTargets?.("compile_error:\nbackend: tsc exit 2\n\nfrontend: tsc exit 2")).toEqual(["backend", "frontend"]);
  expect(selectRepairTargets?.("qa_fail")).toEqual(["backend", "frontend"]);
});

test("executes only the selected repair functions", async () => {
  const activities = await import("./index.ts") as Record<string, unknown>;
  const runSelectedRepairs = activities.runSelectedRepairs as
    | ((targets: string[], plan: unknown, findings: string[], deps: {
        backend: (plan: unknown, findings: string[]) => Promise<unknown>;
        frontend: (plan: unknown, findings: string[]) => Promise<unknown>;
      }) => Promise<void>)
    | undefined;
  const calls: string[] = [];

  await runSelectedRepairs?.(["frontend"], { projectId: "test" }, ["TS7006"], {
    backend: async () => { calls.push("backend"); },
    frontend: async () => { calls.push("frontend"); },
  });

  expect(calls).toEqual(["frontend"]);
});

test("persists failed status through the injected project status writer", async () => {
  const activities = await import("./index.ts") as Record<string, unknown>;
  const markProjectFailed = activities.markProjectFailed as
    | ((projectId: string, reason: string, writeStatus: (projectId: string, status: string) => Promise<void>) => Promise<void>)
    | undefined;
  const writes: Array<{ projectId: string; status: string }> = [];

  await markProjectFailed?.("abc123", "compile_repair_limit", async (projectId, status) => {
    writes.push({ projectId, status });
  });

  expect(writes).toEqual([{ projectId: "abc123", status: "failed" }]);
});

// 2026-07-25 (Phase 6, full MVP upgrade): escalateTilotma was a pure
// console.error stub — found live on nextech10's own run, which hit this
// exact path (qa-fix-loop stuck after 4 rounds, 4 findings not converging).
// The project's status stayed whatever it was before, indistinguishable
// from a healthy in-progress build to anyone reading project status without
// a log tail open.
test("escalateTilotma persists a needs_review status through the injected project status writer", async () => {
  const activities = await import("./index.ts") as Record<string, unknown>;
  const escalateTilotma = activities.escalateTilotma as
    | ((projectId: string, reason: string, state: unknown, writeStatus: (projectId: string, status: string) => Promise<void>) => Promise<void>)
    | undefined;
  const writes: Array<{ projectId: string; status: string }> = [];

  await escalateTilotma?.("nextech10", "stuck_state", { stage: "qa" }, async (projectId, status) => {
    writes.push({ projectId, status });
  });

  expect(writes).toEqual([{ projectId: "nextech10", status: "needs_review" }]);
});
