import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from "fs";
import { join, dirname } from "path";
import type { PipelineCheckpoint } from "./types.ts";

const INVALID_IDENTIFIER = /\.\.|\/|\\/;

// Exported so other project-scoped-filesystem-path builders (e.g. Stage 4's
// per-project keypair path, Tilotma's Tier 3 screenshot path) can reuse the
// exact same guard instead of re-implementing it — see final-whole-branch-
// review.md F5.
export function assertValidIdentifier(name: string, label: "projectId" | "stage"): void {
  if (!name || INVALID_IDENTIFIER.test(name)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(name)} — must not contain "..", "/", or "\\"`
    );
  }
}

function checkpointPath(projectId: string, stage: string): string {
  assertValidIdentifier(projectId, "projectId");
  assertValidIdentifier(stage, "stage");
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  return join(buildDir, projectId, "checkpoints", `${stage}.json`);
}

export function writeCheckpoint(projectId: string, stage: string, data: unknown): void {
  const path = checkpointPath(projectId, stage);
  mkdirSync(dirname(path), { recursive: true });
  const envelope: PipelineCheckpoint = {
    stage,
    data,
    writtenAt: new Date().toISOString(),
  };
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), "utf-8");
  renameSync(tmpPath, path);
}

export function readCheckpoint<T>(projectId: string, stage: string): T | null {
  const path = checkpointPath(projectId, stage);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  let envelope: PipelineCheckpoint<T>;
  try {
    envelope = JSON.parse(raw) as PipelineCheckpoint<T>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Checkpoint corrupt: ${projectId}/${stage} — ${message}`);
  }
  return envelope.data;
}

export function deleteCheckpoint(projectId: string, stage: string): void {
  const path = checkpointPath(projectId, stage);
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

