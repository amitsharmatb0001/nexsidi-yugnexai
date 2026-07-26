import { expect, test } from "bun:test";
import {
  sanitizePublicActivityEvent,
  toPublicActivityEvent,
} from "./public-events.ts";

test("translates an internal tool event without copying raw details", () => {
  const event = toPublicActivityEvent({
    id: "event-1",
    workspaceId: "abc123def456",
    runId: "run-1",
    type: "command_started",
    internalDetail: "Bearer secret-token private-worker C:\\Users\\owner",
    createdAt: "2026-07-19T00:00:00.000Z",
  });
  expect(event).toEqual({
    id: "event-1",
    workspaceId: "abc123def456",
    runId: "run-1",
    category: "command",
    status: "running",
    summary: "Running a workspace command",
    createdAt: "2026-07-19T00:00:00.000Z",
  });
  expect(JSON.stringify(event)).not.toContain("secret-token");
  expect(JSON.stringify(event)).not.toContain("private-worker");
});

test("denies unknown internal event types", () => {
  expect(
    toPublicActivityEvent({
      id: "x",
      workspaceId: "w",
      runId: null,
      type: "raw_log",
      internalDetail: "x",
      createdAt: "now",
    }),
  ).toBeNull();
});

function publicEventWithPath(safePath: string) {
  return toPublicActivityEvent({
    id: "event-path",
    workspaceId: "abc123def456",
    runId: "run-1",
    type: "file_written",
    safePath,
    createdAt: "2026-07-19T00:00:00.000Z",
  });
}

test("normalizes safe workspace-relative paths", () => {
  expect(publicEventWithPath("src\\features\\home.ts")?.safePath).toBe(
    "src/features/home.ts",
  );
  expect(publicEventWithPath("/workspace/src/index.ts")?.safePath).toBe(
    "src/index.ts",
  );
});

test("omits Windows drive paths", () => {
  expect(publicEventWithPath("C:\\Users\\owner\\secret.txt")?.safePath).toBeUndefined();
});

test("omits UNC paths", () => {
  expect(publicEventWithPath("\\\\server\\share\\secret.txt")?.safePath).toBeUndefined();
});

test("omits POSIX absolute paths outside the workspace", () => {
  expect(publicEventWithPath("/etc/passwd")?.safePath).toBeUndefined();
});

test("omits every path containing parent traversal", () => {
  for (const unsafePath of [
    "../secret.txt",
    "src/../../secret.txt",
    "/workspace/../secret.txt",
  ]) {
    expect(publicEventWithPath(unsafePath)?.safePath).toBeUndefined();
  }
});

function candidateEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-safe_1",
    workspaceId: "abc123def456",
    runId: "run-1",
    category: "command",
    status: "running",
    summary: "Bearer secret-token from a private worker",
    createdAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

test("replaces stored summaries and drops unknown fields", () => {
  const sanitized = sanitizePublicActivityEvent({
    ...candidateEvent(),
    internalAgent: "hidden-worker",
    rawCommand: "printenv SECRET_TOKEN",
  });

  expect(sanitized?.summary).toBe("Running a workspace command");
  expect(JSON.stringify(sanitized)).not.toContain("secret-token");
  expect(sanitized).not.toHaveProperty("internalAgent");
  expect(sanitized).not.toHaveProperty("rawCommand");
});

test("omits unsafe stored paths, evidence IDs, and elapsed values", () => {
  for (const safePath of [
    "C:\\Users\\owner\\secret.txt",
    "\\\\server\\share\\secret.txt",
    "/etc/passwd",
    "src/../../secret.txt",
  ]) {
    const sanitized = sanitizePublicActivityEvent(
      candidateEvent({
        safePath,
        evidenceId: "../../secret-evidence",
        elapsedMs: -1,
      }),
    );
    expect(sanitized?.safePath).toBeUndefined();
    expect(sanitized?.evidenceId).toBeUndefined();
    expect(sanitized?.elapsedMs).toBeUndefined();
  }
});

test("preserves validated optional public evidence", () => {
  expect(
    sanitizePublicActivityEvent(
      candidateEvent({
        safePath: "/workspace/src/index.ts",
        evidenceId: "evidence_123",
        elapsedMs: 42,
      }),
    ),
  ).toMatchObject({
    safePath: "src/index.ts",
    evidenceId: "evidence_123",
    elapsedMs: 42,
  });
});

test("rejects unknown categories, statuses, and invalid combinations", () => {
  expect(
    sanitizePublicActivityEvent(candidateEvent({ category: "raw_log" })),
  ).toBeNull();
  expect(
    sanitizePublicActivityEvent(candidateEvent({ status: "streaming" })),
  ).toBeNull();
  expect(
    sanitizePublicActivityEvent(
      candidateEvent({ category: "file", status: "running" }),
    ),
  ).toBeNull();
});

test("rejects malformed records and identifiers", () => {
  for (const candidate of [
    null,
    [],
    candidateEvent({ id: "../../event" }),
    candidateEvent({ workspaceId: "short" }),
    candidateEvent({ runId: "../../run" }),
    candidateEvent({ createdAt: "not-a-date" }),
  ]) {
    expect(sanitizePublicActivityEvent(candidate)).toBeNull();
  }
});
