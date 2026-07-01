import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { GatewayDecision } from "./types.ts";

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
  writeFileSync(path, JSON.stringify({ summary, requestedAt: new Date().toISOString() }, null, 2), "utf-8");
}

export function readGatewayDecision(projectId: string, stage: string): GatewayDecision | null {
  const path = decisionPath(projectId, stage);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  let decision: GatewayDecision;
  try {
    decision = JSON.parse(raw) as GatewayDecision;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Gateway decision corrupt: ${projectId}/${stage} — ${message}`);
  }
  return decision;
}
