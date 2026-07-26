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

// 2026-07-24: same "no '..', '/', or '\\'" rule pipeline/orchestrator/
// checkpoint.ts's assertValidIdentifier enforces for projectId/stage —
// replicated locally (not cross-imported: this package is a low-level
// shared dependency of pipeline/, not the other way around) rather than
// inventing a different identifier rule for the same class of value.
const INVALID_IDENTIFIER = /\.\.|\/|\\/;

function isValidIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !INVALID_IDENTIFIER.test(value);
}

// D30: workspaceId is a 12-char SHA-256 prefix (see CLAUDE.md's
// project-hash convention) — length is part of the validity check, not
// just "is it a string".
function isValidWorkspaceId(value: unknown): value is string {
  return typeof value === "string" && value.length === 12 && !INVALID_IDENTIFIER.test(value);
}

// Reverse-derived from PUBLIC (Layer 6/7 defense-in-depth): the
// (category, status) pair a STORED/retrieved public event claims to have
// is only trusted if it matches one of toPublicActivityEvent's own
// canonical combinations — an unrecognized pair (wrong status for that
// category, or a category/status that was never a real internal event
// type) is rejected outright, never passed through.
const CANONICAL_SUMMARY_BY_CATEGORY_STATUS = new Map<string, string>(
  Object.values(PUBLIC).map(({ category, status, summary }) => [`${category}:${status}`, summary]),
);

// Sanitizes a public-shaped event record coming back from storage/cache —
// a boundary distinct from toPublicActivityEvent (which converts a
// TRUSTED internal event). Treats even an "already public-shaped" record
// as untrusted: re-derives the summary from (category, status) instead of
// trusting a stored summary string (which could have been tampered with,
// or leaked internal detail before ever reaching this sanitizer), strips
// any field not in the known PublicActivityEvent shape, and re-validates
// every identifier/path the same way toPublicActivityEvent does. Returns
// null (never a partially-sanitized object) on any malformed input —
// default-FAIL, same contract as this session's QA/design-brief work.
export function sanitizePublicActivityEvent(
  candidate: unknown,
): PublicActivityEvent | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const c = candidate as Record<string, unknown>;

  if (!isValidIdentifier(c.id)) return null;
  if (!isValidWorkspaceId(c.workspaceId)) return null;
  if (c.runId !== null && !isValidIdentifier(c.runId)) return null;
  if (typeof c.createdAt !== "string" || Number.isNaN(new Date(c.createdAt).getTime())) {
    return null;
  }
  if (typeof c.category !== "string" || typeof c.status !== "string") return null;

  const summary = CANONICAL_SUMMARY_BY_CATEGORY_STATUS.get(`${c.category}:${c.status}`);
  if (summary === undefined) return null; // unknown category, unknown status, or an invalid combination of the two

  const safePath = typeof c.safePath === "string" ? toSafeWorkspacePath(c.safePath) : undefined;
  const elapsedMs = typeof c.elapsedMs === "number" && c.elapsedMs >= 0 ? c.elapsedMs : undefined;
  const evidenceId = isValidIdentifier(c.evidenceId) ? c.evidenceId : undefined;

  return {
    id: c.id as string,
    workspaceId: c.workspaceId as string,
    runId: c.runId as string | null,
    category: c.category as PublicActivityEvent["category"],
    status: c.status as PublicActivityEvent["status"],
    summary,
    ...(safePath ? { safePath } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    ...(evidenceId ? { evidenceId } : {}),
    createdAt: c.createdAt,
  };
}
