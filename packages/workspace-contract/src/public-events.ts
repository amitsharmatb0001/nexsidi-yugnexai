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

function toSafeWorkspacePath(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/");
  const workspacePrefix = "/workspace/";
  const hasWorkspacePrefix = normalized.startsWith(workspacePrefix);

  if (
    /^[a-z]:/i.test(normalized) ||
    normalized.startsWith("//") ||
    (normalized.startsWith("/") && !hasWorkspacePrefix)
  ) {
    return undefined;
  }

  const candidate = hasWorkspacePrefix
    ? normalized.slice(workspacePrefix.length)
    : normalized;
  const segments = candidate.split("/");
  if (segments.some((segment) => segment === "..")) return undefined;

  const relative = segments
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/");
  if (!relative || /^[a-z]:/i.test(relative)) return undefined;
  return relative;
}

export function toPublicActivityEvent(
  input: InternalActivityEvent,
): PublicActivityEvent | null {
  const safe = PUBLIC[input.type];
  if (!safe) return null;
  const safePath = input.safePath
    ? toSafeWorkspacePath(input.safePath)
    : undefined;

  return {
    id: input.id,
    workspaceId: input.workspaceId,
    runId: input.runId,
    ...safe,
    ...(safePath ? { safePath } : {}),
    ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
    ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
    createdAt: input.createdAt,
  };
}
