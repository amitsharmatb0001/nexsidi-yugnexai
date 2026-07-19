import { expect, test } from "bun:test";
import { toPublicActivityEvent } from "./public-events.ts";

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
