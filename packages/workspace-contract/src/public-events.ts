import type { PublicActivityEvent } from "./types.ts";

export interface InternalActivityEvent {
  id: string;
  workspaceId: string;
  runId: string | null;
  type: string;
  internalDetail?: string;
  safePath?: string;
  elapsedMs?: number;
  evidenceId?: string;
  createdAt: string;
}

const PUBLIC: Record<
  string,
  Pick<PublicActivityEvent, "category" | "status" | "summary">
> = {
  planning_started: {
    category: "planning",
    status: "running",
    summary: "Preparing the build specification",
  },
  subtask_started: {
    category: "subtask",
    status: "running",
    summary: "Working on an implementation subtask",
  },
  file_written: {
    category: "file",
    status: "passed",
    summary: "Updated a workspace file",
  },
  command_started: {
    category: "command",
    status: "running",
    summary: "Running a workspace command",
  },
  test_passed: {
    category: "test",
    status: "passed",
    summary: "Test passed",
  },
  test_failed: {
    category: "test",
    status: "failed",
    summary: "Test failed",
  },
  repair_started: {
    category: "repair",
    status: "running",
    summary: "Repairing a verified failure",
  },
  preview_ready: {
    category: "preview",
    status: "passed",
    summary: "Preview is ready",
  },
  delivery_ready: {
    category: "delivery",
    status: "passed",
    summary: "Delivery package is ready",
  },
};

export function toPublicActivityEvent(
  input: InternalActivityEvent,
): PublicActivityEvent | null {
  const safe = PUBLIC[input.type];
  if (!safe) return null;

  return {
    id: input.id,
    workspaceId: input.workspaceId,
    runId: input.runId,
    ...safe,
    ...(input.safePath
      ? {
          safePath: input.safePath
            .replaceAll("\\", "/")
            .replace(/^.*?\/workspace\//, ""),
        }
      : {}),
    ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
    ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
    createdAt: input.createdAt,
  };
}
