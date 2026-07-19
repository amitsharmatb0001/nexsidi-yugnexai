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
