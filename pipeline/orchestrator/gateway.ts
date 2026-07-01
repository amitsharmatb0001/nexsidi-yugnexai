import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from "fs";
import { join, dirname } from "path";
import type { GatewayDecision } from "./types.ts";

const DECISION_READ_RETRY_DELAY_MS = 50;
const DECISION_READ_MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const INVALID_IDENTIFIER = /\.\.|\/|\\/;

function assertValidIdentifier(name: string, label: "projectId" | "stage"): void {
  if (!name || INVALID_IDENTIFIER.test(name)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(name)} — must not contain "..", "/", or "\\"`
    );
  }
}

function requestPath(projectId: string, stage: string): string {
  assertValidIdentifier(projectId, "projectId");
  assertValidIdentifier(stage, "stage");
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  return join(buildDir, projectId, "gateway", `${stage}.request.json`);
}

function decisionPath(projectId: string, stage: string): string {
  assertValidIdentifier(projectId, "projectId");
  assertValidIdentifier(stage, "stage");
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  return join(buildDir, projectId, "gateway", `${stage}.decision.json`);
}

export function writeGatewayRequest(projectId: string, stage: string, summary: string): void {
  const path = requestPath(projectId, stage);
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ summary, requestedAt: new Date().toISOString() }, null, 2), "utf-8");
  renameSync(tmpPath, path);
}

/**
 * Reads and parses the gateway decision file.
 *
 * Unlike checkpoint.ts's readCheckpoint, this file's writer is EXTERNAL to
 * this codebase — a human or UI writes decision.json directly, and this
 * module has no control over (or guarantee of) atomic writes on that side.
 * External writers of decision.json SHOULD write atomically (temp file +
 * rename) to avoid readers ever observing a partial write. The retry below
 * is a defensive backstop for when they don't — it is not a substitute for
 * the external writer doing the right thing.
 *
 * If JSON.parse fails, we assume it may be a transient mid-write read and
 * retry a few times with a short delay before treating the file as
 * genuinely corrupt and throwing.
 */
export async function readGatewayDecision(
  projectId: string,
  stage: string
): Promise<GatewayDecision | null> {
  const path = decisionPath(projectId, stage);
  if (!existsSync(path)) return null;

  let lastError: unknown;
  for (let attempt = 1; attempt <= DECISION_READ_MAX_ATTEMPTS; attempt++) {
    const raw = readFileSync(path, "utf-8");
    try {
      return JSON.parse(raw) as GatewayDecision;
    } catch (err) {
      lastError = err;
      if (attempt < DECISION_READ_MAX_ATTEMPTS) {
        await sleep(DECISION_READ_RETRY_DELAY_MS);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Gateway decision corrupt: ${projectId}/${stage} — ${message}`);
}
