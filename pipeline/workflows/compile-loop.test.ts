import { expect, test } from "bun:test";
import { readFileSync } from "fs";

test("stops post-QA compile repair after the configured maximum", async () => {
  const workflow = await import("./project-build.ts") as Record<string, unknown>;
  const shouldStopCompileRepair = workflow.shouldStopCompileRepair as
    | ((failures: number, maximum: number) => boolean)
    | undefined;

  expect(typeof shouldStopCompileRepair).toBe("function");
  expect(shouldStopCompileRepair?.(2, 3)).toBe(false);
  expect(shouldStopCompileRepair?.(3, 3)).toBe(true);
  expect(shouldStopCompileRepair?.(4, 3)).toBe(true);
});

test("versions the compile-repair workflow change for Temporal replay safety", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain('patched("post-qa-compile-repair-limit-v1")');
});

test("persists project failure before returning from the capped compile loop", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain('patched("persist-project-failure-v1")');
  expect(source).toContain('await act.markProjectFailed(projectId, "compile_repair_limit")');
});
