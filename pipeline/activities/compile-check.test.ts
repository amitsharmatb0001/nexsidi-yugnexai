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

test("live check injects custom-auth JWT configuration and no Clerk secret", async () => {
  const activities = await import("./index.ts") as Record<string, unknown>;
  const buildLiveCheckEnv = activities.buildLiveCheckEnv as
    | ((env: Record<string, string | undefined>) => string[])
    | undefined;

  const args = buildLiveCheckEnv?.({
    JWT_SECRET: "test-jwt-secret",
    CLERK_SECRET_KEY: "obsolete-clerk-secret",
  });

  expect(args).toContain("JWT_SECRET=test-jwt-secret");
  expect(args?.some((value) => value.includes("CLERK"))).toBe(false);
});
