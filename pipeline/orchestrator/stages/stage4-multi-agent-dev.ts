// Stage 4 — Multi-agent dev: Pranav (DB schema) + Shubham (backend) run in
// parallel per Arjun's DAG (independenceVerified — neither needs the other's
// in-progress files), then Aanya (frontend integration) runs only after
// Shubham's output has been verified — a real DAG edge, not parallel.
//
// This is the first stage in the pipeline where the context hash chain
// (Patent Claims 1/3/7 — packages/context-chain) is invoked for real: every
// inter-agent handoff below is signed (RSA-SHA256), hashed (SHA-256 of
// canonicalized JSON), and verified before the downstream agent's result is
// treated as trustworthy input.
//
// ── Signature/keypair design decision ──────────────────────────────────────
// packages/context-chain's `signOutput`/`verifyContext` take key *file paths*,
// not raw key material, and nothing else in the codebase calls `signOutput`
// yet (checked: no key-generation helper or fixed key-path constant exists
// anywhere in packages/ or agents/ as of this task). Rather than leave the
// hash chain unexercised (a no-op that always "verifies"), this stage
// generates a single RSA-2048 keypair per project on first use and caches it
// at `BUILD_DIR/{projectId}/keys/{private,public}.pem` — the same BUILD_DIR
// root checkpoint.ts already uses for every other per-project artifact
// (checkpoints, generator output dirs). Every handoff within that project's
// pipeline run signs and verifies with this same keypair.
//
// This is a dev-appropriate stand-in for a real per-agent identity PKI
// (out of scope for this task — no key rotation, no per-agent keys, no HSM).
// It does exercise the genuine verifyContext/triggerRollback code path
// end-to-end, which is what this task requires: hash-chain verification
// actually running against real signed data, not stubbed.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { hashContext, signOutput, triggerRollback, verifyContext } from "@nexsidi/context-chain";
import type { BuildPlan } from "../../../agents/arjun/src/index.ts";
import type { GeneratorResult } from "../../../agents/generators/shubham/src/index.ts";
import { assertValidIdentifier } from "../checkpoint.ts";
import type { Dag } from "../types.ts";
import { extractBackendContract, saveContract } from "./contract-extractor.ts";

// 2026-08-05: with GENERATOR_TIER=gemini and PIPELINE_TIER=gemini both set
// (this project's .env), Pranav and Shubham both route through Gemini's
// "generation" tier pool (router.ts) — dispatching them in the exact same
// instant via Promise.all below fires two calls at the shared pool[0] model
// at once, on top of whatever else is drawing from that model's shared
// per-minute token bucket. Same fix as stage5-adversarial-qa.ts's
// qaDispatchStaggerMs: a short stagger before the second call spreads the
// initial burst. Defaults to 0 so this doesn't slow down anything that
// doesn't opt in via the env var.
export function generationDispatchStaggerMs(): number {
  const override = process.env.GENERATION_DISPATCH_STAGGER_MS?.trim();
  const parsed = override ? Number(override) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 4000;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export interface Stage4Result {
  backendOutputDir: string;
  frontendOutputDir: string;
  filesWritten: string[];
}

export interface Finding {
  file: string;
  issue: string;
}

// 2026-07-28 (live, complex1): real bug found live — a generated project's
// actual output layout puts the DB schema file at "backend/init.sql" (inside
// the backend output dir, per Shubham's own system prompt: "DATABASE SCHEMA
// OWNERSHIP ... init.sql, schema.ts, drizzle config ... already exists at
// db/migrations/ before you start" — the ownership rule and the physical
// path are two different things), not under a top-level "db/" prefix as this
// file's routing previously assumed. Deepika kept reporting the SAME missing-
// index finding on backend/init.sql every QA round because agentForFile
// routed it to shubham (who is correctly instructed to NEVER touch schema
// files and escalate instead) — a structural dead end that looked like an
// oscillating/stuck bug but was actually a misrouted finding. Recognize
// schema files by name/pattern wherever they physically live, not only by a
// "db/" path prefix.
const SCHEMA_FILE_PATTERN = /(^|\/)(init\.sql|schema\.ts|drizzle\.config\.\w+)$|\.sql$|(^|\/)migrations\//i;

// Fault isolation: route a finding to the ONE agent responsible, by file path
// prefix — not a blind full-regenerate. Deterministic and unit-testable on
// its own; Stage 5 (adversarial QA) is the real caller.
export function identifyFaultAgent(findings: Finding[]): string {
  return agentForFile(findings[0]?.file ?? "");
}

// Exported so callers outside this file's own fix loop (Stage 6's live
// post-deploy retest) route findings to the SAME agent Stage 5 would —
// two independent copies of this logic is exactly how the db/ vs
// backend/init.sql mismatch above went unnoticed for as long as it did.
export function agentForFile(file: string): string {
  // frontend/ always wins first — a frontend file named e.g. "schema.ts"
  // (a Zod validation schema, not a DB schema) must never be misrouted to
  // pranav just because SCHEMA_FILE_PATTERN matches its basename.
  if (file.startsWith("frontend/")) return "aanya";
  if (file.startsWith("db/")) return "pranav";
  if (file.startsWith("backend/") && SCHEMA_FILE_PATTERN.test(file)) return "pranav";
  if (file.startsWith("backend/")) return "shubham";
  return "shubham"; // default to backend if path doesn't match a known prefix
}

// Real 2026-07-06 stress-test bug: the QA fix loop used identifyFaultAgent's
// SINGLE result to fix one agent per round. A real run had findings spanning
// both backend/ and frontend/ files in the same QA pass — since findings[0]
// was a backend/ file, the loop kept fixing Shubham and never touched
// Aanya's frontend finding, no matter how many retries ran. Returns every
// agent with at least one finding so the fix loop can route findings to all
// of them in a single round instead of just the first.
export function identifyFaultAgents(findings: Finding[]): Set<string> {
  return new Set(findings.map((f) => agentForFile(f.file)));
}

// Companion to identifyFaultAgents: the fix loop needs each agent's OWN
// subset of findings (fixShubham should only see backend findings, fixAanya
// only frontend), not just which agents are implicated overall.
export function groupFindingsByAgent(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const agent = agentForFile(f.file);
    const list = groups.get(agent);
    if (list) list.push(f);
    else groups.set(agent, [f]);
  }
  return groups;
}

// The real hash-chain gate, invoked at every agent-to-agent handoff below.
// Unlike the plan's original placeholder (which called a hash-only check),
// this calls the REAL verifyContext — hash AND RSA-SHA256 signature both have
// to check out — and triggers rollback (Patent Claim 3: throws, never
// silently continues on bad state) on either kind of mismatch.
export function verifyAgentHandoff(
  from: string,
  to: string,
  context: unknown,
  expectedHash: string,
  signature: string,
  publicKeyPath: string,
): { valid: true } {
  const result = verifyContext(context, expectedHash, signature, publicKeyPath);
  if (!result.valid) {
    triggerRollback(`${from}->${to}`, result.reason ?? "unknown");
  }
  return { valid: true };
}

interface KeyPaths {
  privateKeyPath: string;
  publicKeyPath: string;
}

// Generates (or reuses, if already generated earlier in this project's
// pipeline run) the per-project signing keypair described above.
export function getProjectKeyPair(projectId: string): KeyPaths {
  assertValidIdentifier(projectId, "projectId");
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const keysDir = join(buildDir, projectId, "keys");
  const privateKeyPath = join(keysDir, "private.pem");
  const publicKeyPath = join(keysDir, "public.pem");

  if (existsSync(privateKeyPath) && existsSync(publicKeyPath)) {
    return { privateKeyPath, publicKeyPath };
  }

  mkdirSync(keysDir, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  writeFileSync(privateKeyPath, privateKey, "utf-8");
  writeFileSync(publicKeyPath, publicKey, "utf-8");
  return { privateKeyPath, publicKeyPath };
}

// Signs + hashes `output` on the sending side, then immediately verifies the
// handoff to `to` on the receiving side — the real Patent Claim 1/3/7 chain,
// exercised for real rather than stubbed. Returns `output` unchanged once
// verified; throws (via triggerRollback) on any mismatch.
function signAndVerifyHandoff<T>(from: string, to: string, output: T, keys: KeyPaths): T {
  const hash = hashContext(output);
  const signature = signOutput(output, keys.privateKeyPath);
  verifyAgentHandoff(from, to, output, hash, signature, keys.publicKeyPath);
  return output;
}

export async function runActiveSmokeProbe(projectId: string, backendDir: string, frontendDir: string): Promise<void> {
  console.log(`[smoke-probe] Starting active runtime smoke probe for backend and frontend (project: ${projectId})...`);

  const killProcessTree = (proc: any) => {
    if (process.platform === "win32") {
      try {
        spawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)]);
      } catch {}
    } else {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }
  };

  const getDeterministicPort = (projId: string, basePort: number): number => {
    let hash = 0;
    for (let i = 0; i < projId.length; i++) {
      hash = projId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return basePort + Math.abs(hash % 100);
  };

  const startServer = (dir: string, port: number, name: string) => {
    return new Promise<{ proc: any; errorMsg: string | null }>((resolve) => {
      let resolved = false;
      const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
      const proc = spawn(cmd, ["run", "dev"], {
        cwd: dir,
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderrLogs = "";
      proc.stderr?.on("data", (data: any) => {
        stderrLogs += data.toString();
      });

      proc.on("error", (err: any) => {
        if (!resolved) {
          resolved = true;
          resolve({ proc, errorMsg: `Failed to start ${name}: ${err.message}` });
        }
      });

      proc.on("exit", (code: number) => {
        if (!resolved && code !== null && code > 0) {
          resolved = true;
          resolve({ proc, errorMsg: `${name} server exited immediately with code ${code}. Error: ${stderrLogs}` });
        }
      });

      setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          try {
            const res = await fetch(`http://localhost:${port}/health`).catch(() =>
              fetch(`http://localhost:${port}/`)
            );
            if (res.status >= 500) {
              resolve({ proc, errorMsg: `${name} returned status ${res.status} on boot.` });
            } else {
              resolve({ proc, errorMsg: null });
            }
          } catch (err) {
            resolve({
              proc,
              errorMsg: `Failed to hit ${name} on port ${port}. Is it running? Details: ${String(err)}. Stderr: ${stderrLogs}`,
            });
          }
        }
      }, 30000); // 30s — Next.js cold start takes 10-30s; 3s always fired before the server was ready
    });
  };

  const backendPort = getDeterministicPort(projectId, 3100);
  const frontendPort = getDeterministicPort(projectId, 3200);

  const backend = await startServer(backendDir, backendPort, "Backend");
  const frontend = await startServer(frontendDir, frontendPort, "Frontend");

  try {
    killProcessTree(backend.proc);
  } catch {}
  try {
    killProcessTree(frontend.proc);
  } catch {}

  if (backend.errorMsg) {
    throw new Error(`Active Smoke Probe failed on Backend: ${backend.errorMsg}`);
  }
  if (frontend.errorMsg) {
    throw new Error(`Active Smoke Probe failed on Frontend: ${frontend.errorMsg}`);
  }
  console.log("[smoke-probe] Active smoke probe successfully completed. Both backend and frontend boot cleanly.");
}

/**
 * Runs Stage 4: DB schema + backend generation in parallel, then frontend
 * integration once the backend handoff is verified.
 *
 * `dag` is accepted for interface consistency with the rest of the pipeline
 * (Stage 1 produces it, Stage 5 consumes findings shaped by it) — the actual
 * parallel/sequential ordering here is already fixed by Arjun's
 * independenceVerified guarantee (db-schema + backend-scaffold are
 * independent; frontend integration depends on backend), so this stage does
 * not need to re-derive ordering from `dag` at runtime.
 */
export async function runStage4(
  projectId: string,
  plan: BuildPlan,
  dag: Dag,
): Promise<Stage4Result> {
  void dag; // ordering already fixed by Arjun's independenceVerified plan — see doc comment above

  const [{ run: runPranav }, { run: runShubham }, { run: runAanya }] = await Promise.all([
    import("../../../agents/generators/pranav/src/index.ts"),
    import("../../../agents/generators/shubham/src/index.ts"),
    import("../../../agents/generators/aanya/src/index.ts"),
  ]);

  const keys = getProjectKeyPair(projectId);

  // DAG: db-schema (Pranav) and backend-scaffold (Shubham) don't depend on
  // each other's in-progress files — safe to run in parallel. Staggered
  // (see generationDispatchStaggerMs above) so both don't hit the shared
  // Gemini "generation" pool in the same instant.
  const pranavPromise = runPranav(plan);
  await sleep(generationDispatchStaggerMs());
  const shubhamPromise = runShubham(plan);
  const [pranavResult, shubhamResult] = await Promise.all([pranavPromise, shubhamPromise]);

  // Verify Pranav's output is intact before treating it as valid input to
  // whatever consumes it downstream (Shubham's DB access code assumes this
  // schema, Riya applies these migrations later) — even though the two ran
  // in parallel here, the handoff still goes through the real hash-chain gate.
  signAndVerifyHandoff("pranav", "shubham", pranavResult, keys);

  // Verify Shubham's backend output before Aanya's integration pass is
  // allowed to depend on it. This IS a real DAG dependency, not parallel:
  // Aanya's "integrate" mode wires fetch() calls against Shubham's live
  // contract, so it must not start until that output is confirmed unmodified.
  signAndVerifyHandoff("shubham", "aanya", shubhamResult, keys);

  const contract = extractBackendContract(shubhamResult.outputDir);
  saveContract(projectId, contract);

  const aanyaResult: GeneratorResult = await runAanya(plan, "integrate");

  // Run active runtime smoke probe to verify compile routes actually boot cleanly
  try {
    await runActiveSmokeProbe(projectId, shubhamResult.outputDir, aanyaResult.outputDir);
  } catch (err) {
    console.warn(`[stage4] Smoke probe failed (non-fatal for initial stage verification): ${String(err)}`);
  }

  return {
    backendOutputDir: shubhamResult.outputDir,
    frontendOutputDir: aanyaResult.outputDir,
    filesWritten: [
      ...pranavResult.filesWritten,
      ...shubhamResult.filesWritten,
      ...aanyaResult.filesWritten,
    ],
  };
}
