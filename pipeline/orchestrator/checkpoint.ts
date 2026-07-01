import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

function checkpointPath(projectId: string, stage: string): string {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  return join(buildDir, projectId, "checkpoints", `${stage}.json`);
}

export function writeCheckpoint(projectId: string, stage: string, data: unknown): void {
  const path = checkpointPath(projectId, stage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

export function readCheckpoint<T>(projectId: string, stage: string): T | null {
  const path = checkpointPath(projectId, stage);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}
