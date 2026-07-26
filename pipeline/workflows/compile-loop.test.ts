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

// 2026-07-25 (Phase 2.1, full MVP upgrade): the two tests below used to
// assert on patched("post-qa-compile-repair-limit-v1") and
// patched("persist-project-failure-v1") — nested replay-safety markers that
// lived ONLY inside the legacy pre-unification QA loop, guarding its OWN
// gradual rollout. That loop has since been deleted as provably
// unreachable: patched("unify-real-gan-and-deploy-v1") (the OUTER gate,
// still asserted below) is unconditionally true for every workflow started
// after 2026-07-24, and the branch it guards always returns before the
// deleted code could ever run — see project-build.ts's own comment at the
// deletion site and .nexsidi/sdd/audit-2026-07-25.md. The nested patches
// were themselves legacy scaffolding for a rollout the outer patch already
// completed; once the branch they lived in is unreachable, keeping their
// string in source serves no replay-safety purpose (no workflow history
// can be paused at a point that would need them). These tests now assert
// the CURRENT replay-safety story: the still-load-bearing outer patch, and
// that failure is still persisted unconditionally on the live path (no
// longer behind its own extra patch marker, since the outer gate already
// makes this the only path new workflows take).
test("versions the unified GAN/deploy workflow change for Temporal replay safety", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain('patched("unify-real-gan-and-deploy-v1")');
});

test("persists project failure before returning from the capped compile loop", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain('await act.markProjectFailed(projectId, "compile_repair_limit")');
});
