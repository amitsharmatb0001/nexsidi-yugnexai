const fs = require("fs");
const path = require("path");

const target = path.resolve(__dirname, "../pipeline/workflows/project-build.ts");
console.log("Reading:", target);
let content = fs.readFileSync(target, "utf-8");

// Normalize line endings to LF
content = content.replace(/\r\n/g, "\n");

const lines = content.split("\n");

// Find the line index where Pipeline State starts
const stateIndex = lines.findIndex(line => line.includes("// ─── Pipeline State"));
console.log("Pipeline State index:", stateIndex);

if (stateIndex === -1) {
  console.error("Could not find Pipeline State!");
  process.exit(1);
}

// Slice from Pipeline State to the end of the file
const restOfFile = lines.slice(stateIndex).join("\n");

const newTop = `// Main NexSidi build pipeline — Temporal workflow
//
// Fix #7: stuck-state counter lives IN workflow state (not in-memory),
//         so it survives Temporal worker restarts and is visible in the UI.
// Fix #8: any single QA agent scoring <85 blocks — NOT the average.

import {
  proxyActivities,
  defineQuery,
  defineSignal,
  setHandler,
  sleep,
  patched,
  condition,
} from "@temporalio/workflow";
import type * as activities from "../activities/index.ts";

// Short timeout for single-LLM-call activities (spec, QA, compliance)
const act = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  heartbeatTimeout: "2 minutes",   // reschedule if worker dies within 2 min
  retry: { maximumAttempts: 3 },
});

// Long timeout for code generation — multiple sequential NIM calls per task list
const genAct = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  heartbeatTimeout: "3 minutes",   // NIM calls take up to 90s + 30s heartbeat gap
  retry: { maximumAttempts: 5 },   // more headroom while we tune the output format
});

// Deploy proxy — no heartbeatTimeout because execSync blocks the event loop
// startToCloseTimeout must cover: docker build (5 min) + startup (1 min) + GitHub (1 min)
const deployAct = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: { maximumAttempts: 2 },
});

export const approveSpecSignal = defineSignal<[boolean]>("approveSpecSignal");
export const approveDeploySignal = defineSignal<[boolean]>("approveDeploySignal");

`;

let patchedContent = newTop + restOfFile;

// Let's do string replacements for the gates inside the workflow body
// 1. Add signal state variables at the start of projectBuildWorkflow
const targetStart = `  setHandler(getPipelineState, () => ({ ...state }));`;
const replacementStart = `  setHandler(getPipelineState, () => ({ ...state }));\n\n  let specApproved = false;\n  setHandler(approveSpecSignal, (approved) => {\n    specApproved = approved;\n  });\n\n  let deployApproved = false;\n  setHandler(approveDeploySignal, (approved) => {\n    deployApproved = approved;\n  });`;

if (patchedContent.includes(targetStart)) {
  patchedContent = patchedContent.replace(targetStart, replacementStart);
  console.log("Start signals added successfully.");
} else {
  console.error("Start target NOT found!");
}

// 2. Add Gate 1 and conditional generation after decompose
const targetDecompose = `  // ── Stage 2: Task decomposition ─────────────────────────────────────────\n  state.stage = "decompose";\n  await act.runArjun(projectId);\n\n  // ── Stage 3: Parallel code generation ───────────────────────────────────\n  state.stage = "generate";\n  await Promise.all([\n    genAct.runShubham(projectId),\n    genAct.runAanya(projectId),\n    genAct.runPranav(projectId),\n  ]);`;

const replacementDecompose = `  // ── Stage 2: Task decomposition ─────────────────────────────────────────
  state.stage = "decompose";
  await act.runArjun(projectId);

  // GATE 1: Spec/Plan Approval
  state.stage = "await_spec_approval";
  await condition(() => specApproved);

  // ── Stage 3: Parallel code generation ───────────────────────────────────
  state.stage = "generate";
  const needs = await act.checkPlanNeeds(projectId);
  const genPromises: Promise<void>[] = [genAct.runAanya(projectId)];
  if (needs.shubham) {
    genPromises.push(genAct.runShubham(projectId));
  }
  if (needs.pranav) {
    genPromises.push(genAct.runPranav(projectId));
  }
  await Promise.all(genPromises);`;

if (patchedContent.includes(targetDecompose)) {
  patchedContent = patchedContent.replace(targetDecompose, replacementDecompose);
  console.log("Decompose gate & modular generation added successfully.");
} else {
  console.log("Target decompose block mismatch, trying normalization...");
  // Try normalized whitespace check
  const normalizedTarget = targetDecompose.replace(/\s+/g, " ");
  // Let's do a direct replace if found
}

// 3. Add Gate 2 before stage deliver
const targetDeliver = `  // ── Stage 4: Delivery ───────────────────────────────────────────────────\n  state.stage = "deliver";`;
const replacementDeliver = `  // GATE 2: Deployment/Rollout Approval\n  state.stage = "await_deploy_approval";\n  await condition(() => deployApproved);\n\n  // ── Stage 4: Delivery ───────────────────────────────────────────────────\n  state.stage = "deliver";`;

if (patchedContent.includes(targetDeliver)) {
  patchedContent = patchedContent.replace(targetDeliver, replacementDeliver);
  console.log("Delivery gate added successfully.");
} else {
  console.error("Delivery target NOT found!");
}

// Write back with CRLF line endings
fs.writeFileSync(target, patchedContent.replace(/\n/g, "\r\n"), "utf-8");
console.log("Patched pipeline/workflows/project-build.ts successfully!");
