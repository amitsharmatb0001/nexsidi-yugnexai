import { expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import {
  buildRuns,
  workspaceEvents,
  workspaceMessages,
  workspaceSpecs,
  workspaceTurns,
} from "./schema.ts";

test("exports every durable workspace table", () => {
  expect(
    [workspaceMessages, workspaceTurns, workspaceSpecs, buildRuns, workspaceEvents].map(
      getTableName,
    ),
  ).toEqual([
    "workspace_messages",
    "workspace_turns",
    "workspace_specs",
    "build_runs",
    "workspace_events",
  ]);
});
