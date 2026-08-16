import { expect, test } from "bun:test";
import { readFileSync } from "fs";

// 2026-08-17 (live, fulfillio1): a Stage-6-only failure (context-chain hash
// mismatch, budget exceeded, etc.) that kills the whole workflow execution
// used to mean the ONLY way to make progress was starting a brand new
// workflow — which re-runs Saanvi/Arjun/generation/QA from scratch even
// though all of that work already succeeded and is untouched on disk/DB.
// resumeFromDeploy skips straight to Gate 2 + Stage 6 for a project whose
// spec/plan/generated-code/QA-pass already exist. Same lightweight
// source-string convention as this file's siblings, given a full
// TestWorkflowEnvironment run isn't set up in this repo yet.
test("projectBuildWorkflow accepts an optional resumeFromDeploy parameter", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  expect(source).toContain(
    "export async function projectBuildWorkflow(projectId: string, userRequest?: string, resumeFromDeploy?: boolean): Promise<void>",
  );
});

test("resumeFromDeploy short-circuits straight to Gate 2 + Stage 6, before Stage 1's spec loop", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  const resumeBranch = source.indexOf("if (resumeFromDeploy)");
  const stage1Loop = source.indexOf("// ── Stage 1+2: Spec, design, and decomposition");
  expect(resumeBranch).toBeGreaterThan(-1);
  expect(stage1Loop).toBeGreaterThan(-1);
  expect(resumeBranch).toBeLessThan(stage1Loop);
});

// The resume branch and the normal post-QA path must call the SAME
// function, not two copies — two copies is exactly how the recordHandoff-
// timing bug (fixed just above this in the same commit) could silently
// regress in one path while looking fixed in the other.
test("resumeFromDeploy and the normal post-QA path share one runGate2AndStage6 implementation, not duplicated logic", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  const defCount = (source.match(/async function runGate2AndStage6/g) ?? []).length;
  const callCount = (source.match(/await runGate2AndStage6\(\)/g) ?? []).length;
  expect(defCount).toBe(1);
  expect(callCount).toBe(2); // once from resumeFromDeploy, once from the normal post-QA flow
});

test("runGate2AndStage6 re-records the deploy context-chain handoff on every retry, inside the loop", () => {
  const source = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");

  const fnStart = source.indexOf("async function runGate2AndStage6");
  const fnBody = source.slice(fnStart, source.indexOf("\n  }\n", fnStart));
  const loopStart = fnBody.indexOf("for (;;) {");
  const recordCall = fnBody.indexOf("recordDeployHandoffActivity(projectId)");
  expect(loopStart).toBeGreaterThan(-1);
  expect(recordCall).toBeGreaterThan(loopStart); // inside the loop, not once before it
});
