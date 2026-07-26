const fs = require("fs");
const path = require("path");

const target = path.resolve(__dirname, "../pipeline/activities/index.ts");
console.log("Reading:", target);
let content = fs.readFileSync(target, "utf-8");

// Normalize line endings to LF
content = content.replace(/\r\n/g, "\n");

const lines = content.split("\n");

// We find the line index where runPranav starts (1-based index 22, so index 21)
const pranavIndex = lines.findIndex(line => line.includes("export async function runPranav"));
console.log("Pranav index:", pranavIndex);

if (pranavIndex === -1) {
  console.error("Could not find runPranav!");
  process.exit(1);
}

// Slice from runPranav to the end of the file
const restOfFile = lines.slice(pranavIndex).join("\n");

const newTop = `// Temporal activities — one per pipeline stage.
// Each is retryable, timeout-bounded, and observable in Temporal UI.
// All TODO stubs are now replaced with real agent calls.

import { run as runSaanviAgent }  from "../../agents/saanvi/src/index.ts";
import { run as runArjunAgent, getBuildDir }   from "../../agents/arjun/src/index.ts";
import { run as runShubhamAgent, runFix as runShubhamFix } from "../../agents/generators/shubham/src/index.ts";
import { run as runAanyaAgent, runFix as runAanyaFix }   from "../../agents/generators/aanya/src/index.ts";
import { run as runPranavAgent }  from "../../agents/generators/pranav/src/index.ts";
import { run as runRiyaAgent }    from "../../agents/riya/src/index.ts";
import { agentChat }               from "@nexsidi/llm-client";
import { db, projects, qaResults, stuckStateLog } from "@nexsidi/db";
import { eq, and } from "drizzle-orm";
import { Context }                 from "@temporalio/activity";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { execSync, spawnSync } from "child_process";
import type { ProjectSpec } from "../../agents/saanvi/src/index.ts";
import type { BuildPlan }   from "../../agents/arjun/src/index.ts";

// ── In-process cache (activities run in same Temporal worker process)
const specCache = new Map<string, ProjectSpec>();
const planCache = new Map<string, BuildPlan>();

function getAttachmentsContext(projectId: string): string {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const attachmentsDir = join(buildDir, projectId, "attachments");
  if (!existsSync(attachmentsDir)) return "";

  try {
    const files = readdirSync(attachmentsDir);
    if (files.length === 0) return "";

    let context = "\\n\\n=== USER UPLOADED ATTACHMENTS ===\\n";
    for (const file of files) {
      const filePath = join(attachmentsDir, file);
      const stat = statSync(filePath);
      if (stat.isFile()) {
        context += \`File: \${file} (\${stat.size} bytes)\\n\`;
        const isText = /\\.(txt|json|md|ts|js|tsx|jsx|html|css|csv|xml|yaml|yml)$/i.test(file);
        if (isText && stat.size < 200000) {
          const content = readFileSync(filePath, "utf-8");
          context += \`Content:\\n\\"\\"\\"\\n\${content}\\n\\"\\"\\"\\n\\n\`;
        } else {
          context += \`[Non-text or large binary file: content not printed]\\n\\n\`;
        }
      }
    }
    return context;
  } catch (err) {
    console.warn("Failed to read attachments context:", err);
    return "";
  }
}

// ── Stage 1: Requirements → locked ProjectSpec ─────────────────────────────────
export async function runSaanvi(projectId: string, userRequest?: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    if (userRequest) writeCacheFile(projectId, "user-request.txt", userRequest);
    const req  = userRequest ?? readUserRequest(projectId);
    const attachmentsContext = getAttachmentsContext(projectId);
    const enrichedReq = req + attachmentsContext;
    const spec = await runSaanviAgent(projectId, enrichedReq);
    specCache.set(projectId, spec);
    writeCacheFile(projectId, "spec.json", JSON.stringify(spec, null, 2));
    console.log(\`[activity:saanvi] spec locked for \${projectId} — \${spec.features.length} features\`);
  } finally {
    clearInterval(hb);
  }
}

// ── Stage 2: Spec → BuildPlan (API contract + DB schema + task decomp) ─────────
export async function runArjun(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    const spec = specCache.get(projectId) ?? readCacheFile<ProjectSpec>(projectId, "spec.json");
    const plan = await runArjunAgent(spec);
    planCache.set(projectId, plan);
    writeCacheFile(projectId, "build-plan.json", JSON.stringify(plan, null, 2));
    console.log(\`[activity:arjun] plan ready — \${plan.apiContract.endpoints.length} endpoints, \${plan.dbSchema.tables.length} tables\`);
  } finally {
    clearInterval(hb);
  }
}

// ── Stage 3a–c: code generators (run in parallel from workflow) ───────────────
export async function runShubham(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    const result = await runShubhamAgent(getPlan(projectId));
    if (!result.success) throw new Error(\`[shubham] \${result.errors.join("; ")}\`);
    console.log(\`[activity:shubham] \${result.filesWritten.length} files → \${result.outputDir}\`);
  } finally {
    clearInterval(hb);
  }
}

export async function runAanya(projectId: string): Promise<void> {
  const ctx = Context.current();
  const hb  = setInterval(() => ctx.heartbeat("running"), 30_000);
  try {
    const result = await runAanyaAgent(getPlan(projectId), "integrate");
    if (!result.success) throw new Error(\`[aanya] \${result.errors.join("; ")}\`);
    console.log(\`[activity:aanya] \${result.filesWritten.length} files → \${result.outputDir}\`);
  } finally {
    clearInterval(hb);
  }
}

`;

const finalContent = newTop + restOfFile;

// Write back with CRLF line endings on Windows
fs.writeFileSync(target, finalContent.replace(/\n/g, "\r\n"), "utf-8");
console.log("Patched pipeline/activities/index.ts successfully!");
