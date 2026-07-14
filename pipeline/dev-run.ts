// pipeline/dev-run.ts
// Tight dev runner — calls runPipeline() directly (no Temporal needed).
// Pre-approves Stage 2 + Stage 3 gateways so they don't block.
// Hard 20-minute timeout. Exits immediately on error with exact stage + cause.
//
// Run: bun pipeline/dev-run.ts
// Resume after crash: bun pipeline/dev-run.ts --resume  (keeps existing checkpoints)

import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "./orchestrator/run.ts";

const PROJECT_ID = "dev-taskmanager-001";
const USER_INPUT =
  "Build me a task manager — sign up, add tasks with due dates, check them off";
const BUILD_DIR = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
const RESUME = process.argv.includes("--resume");
const TIMEOUT_MS = 60 * 60 * 1000; // 60 min hard cap — NIM generators + Gemini QA

// ── Gate helpers ──────────────────────────────────────────────────────────────

function clearCheckpoints(): void {
  const dir = join(BUILD_DIR, PROJECT_ID, "checkpoints");
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    log("Cleared checkpoints — fresh run");
  }
}

// Pre-write both gateway decision files BEFORE the pipeline starts.
// Stage 2 and Stage 3 poll for these; finding them immediately means
// zero blocking time instead of 30-minute human approval windows.
function preApproveGateways(): void {
  for (const stage of ["02-gateway", "03-ui-preview"]) {
    const dir = join(BUILD_DIR, PROJECT_ID, "gateway");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${stage}.decision.json`);
    writeFileSync(path, JSON.stringify({ decision: "proceed" }, null, 2), "utf-8");
    log(`Gateway pre-approved: ${stage}`);
  }
}

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`[dev-run ${ts}] ${msg}`);
}

function sep(): void {
  console.log("─".repeat(60));
}

// ── Stage timing — patch console.log lines that already come from the pipeline ─
// The pipeline emits "[orchestrator]" and "[stage*]" prefixed lines naturally;
// we just add a wall-clock timestamp to each to catch stuck stages fast.

const _origLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const ts = new Date().toISOString().slice(11, 23);
  _origLog(`[${ts}]`, ...args);
};
const _origWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const ts = new Date().toISOString().slice(11, 23);
  _origWarn(`[${ts}] ⚠`, ...args);
};
const _origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const ts = new Date().toISOString().slice(11, 23);
  _origError(`[${ts}] ✗`, ...args);
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startMs = Date.now();

  sep();
  log("NexSidi Pipeline — Dev Run");
  log(`Project   : ${PROJECT_ID}`);
  log(`Input     : "${USER_INPUT}"`);
  log(`Build dir : ${BUILD_DIR}`);
  log(`QA tier   : ${process.env.QA_TIER ?? "nim (default)"}`);
  log(`Gen tier  : ${process.env.GENERATOR_TIER ?? "nim (default)"}`);
  log(`Mode      : ${RESUME ? "RESUME (keeping checkpoints)" : "FRESH (clearing checkpoints)"}`);
  sep();

  if (!RESUME) clearCheckpoints();
  preApproveGateways();

  // Hard timeout — detects a silently stuck stage (e.g. gateway never resolved,
  // infinite agent loop, Ollama hung). Shows which checkpoints exist so you
  // know exactly which stage was running when it timed out.
  const timer = setTimeout(() => {
    _origError(`\n[dev-run] ⛔ TIMEOUT after ${TIMEOUT_MS / 60000} min`);
    _origError(`[dev-run] Checkpoints written so far:`);
    try {
      const cpDir = join(BUILD_DIR, PROJECT_ID, "checkpoints");
      if (existsSync(cpDir)) {
        readdirSync(cpDir).forEach((f) => _origError(`  ✓ ${f}`));
      } else {
        _origError("  (none — failed before Stage 1 completed)");
      }
    } catch { /* ignore */ }
    process.exit(2);
  }, TIMEOUT_MS);
  timer.unref();

  try {
    await runPipeline(PROJECT_ID, USER_INPUT);

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    sep();
    log(`✓ Pipeline complete in ${elapsed}s`);
    log(`Output: ${join(BUILD_DIR, PROJECT_ID)}`);
    sep();
  } catch (err) {
    clearTimeout(timer);
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    sep();
    _origError(`[dev-run] ✗ Pipeline failed after ${elapsed}s`);

    // Print existing checkpoints so the user knows which stage crashed
    try {
      const cpDir = join(BUILD_DIR, PROJECT_ID, "checkpoints");
      if (existsSync(cpDir)) {
        const cps = readdirSync(cpDir);
        _origError(`[dev-run] Completed stages before crash:`);
        cps.forEach((f) => _origError(`  ✓ ${f}`));
        const stageOrder = ["01-requirements", "02-gateway", "03-ui-preview", "04-dev", "05-qa", "06-deployment"];
        const done = new Set(cps.map((f) => f.replace(".json", "")));
        const crashed = stageOrder.find((s) => !done.has(s));
        if (crashed) _origError(`[dev-run] Crashed at: ${crashed}`);
      }
    } catch { /* ignore */ }

    _origError(`[dev-run] Error:`, err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      _origError(err.stack.split("\n").slice(1, 6).join("\n"));
    }
    sep();
    process.exit(1);
  }
}

main();
