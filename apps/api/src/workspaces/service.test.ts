import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import { computeSpecHash } from "@nexsidi/workspace-contract/spec";
import type {
  PublicActivityEvent,
  WorkspaceSpec,
} from "@nexsidi/workspace-contract/types";
import { MemoryWorkspaceStore } from "./memory-store.ts";
import { PostgresWorkspaceStore } from "./postgres-store.ts";
import { WorkspaceService } from "./service.ts";

type DraftSpecInput = Omit<
  WorkspaceSpec,
  "hash" | "status" | "createdAt" | "approvedAt" | "approvedBy"
>;

function draftSpec(
  workspaceId: string,
  version = 1,
  overrides: Partial<DraftSpecInput> = {},
): DraftSpecInput {
  return {
    id: randomUUID(),
    workspaceId,
    version,
    originalRequest: "Build a focused task manager",
    confirmedFacts: [
      { id: "fact-1", key: "audience", value: "teams", source: "user" },
    ],
    questions: [],
    assumptions: [],
    scope: [
      {
        id: "scope-1",
        key: "tasks",
        title: "Tasks",
        description: "Create and complete tasks",
        state: "confirmed",
      },
    ],
    userJourneys: [
      {
        id: "journey-1",
        title: "Manage a task",
        steps: ["Create", "Complete"],
        requirementIds: ["scope-1"],
      },
    ],
    pages: [],
    dataModel: [],
    apiContracts: [],
    auth: { mode: "none", roles: [] },
    design: { direction: "Calm and direct" },
    sources: [],
    acceptanceCriteria: [
      {
        id: "acceptance-1",
        statement: "A task can be completed",
        requirementIds: ["scope-1"],
      },
    ],
    ...overrides,
  };
}

function event(
  workspaceId: string,
  id: string,
  summary: string,
): PublicActivityEvent {
  return {
    id,
    workspaceId,
    runId: null,
    category: "planning",
    status: "passed",
    summary,
    createdAt: new Date().toISOString(),
  };
}

describe("workspace ownership and snapshots", () => {
  test("creates a trimmed workspace and returns its browser-safe snapshot", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "  Nextech  ");

    expect(workspace.name).toBe("Nextech");
    expect(workspace.phase).toBe("intake");
    expect(workspace.messages).toEqual([]);
    expect(workspace.activeSpec).toBeNull();
    expect(workspace.activeRun).toBeNull();
    expect(workspace.eventCursor).toBe(0);
    expect(workspace.id).toHaveLength(12);
    expect(Object.keys(workspace).sort()).toEqual([
      "activeRun",
      "activeSpec",
      "eventCursor",
      "id",
      "messages",
      "name",
      "ownerId",
      "phase",
    ]);
  });

  test("uses a safe default name for an empty project name", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "   ");

    expect(workspace.name).toBe("New Project");
  });

  test("does not allow another owner to read a workspace", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Private");

    await expect(service.snapshot("user-2", workspace.id)).rejects.toThrow(
      "workspace_not_found",
    );
  });

  test("obscures workspace existence across all owned service operations", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Private");
    const input = draftSpec(workspace.id);

    await expect(
      service.beginTurn(
        "user-2",
        workspace.id,
        "turn-1",
        "message-1",
        "Hello",
      ),
    ).rejects.toThrow("workspace_not_found");
    await expect(
      service.saveDraftSpec("user-2", workspace.id, input),
    ).rejects.toThrow("workspace_not_found");
    await expect(
      service.approveSpecAndCreateRun(
        "user-2",
        workspace.id,
        input.id,
        "a".repeat(64),
        "approve-1",
      ),
    ).rejects.toThrow("workspace_not_found");
    await expect(
      service.listEvents("user-2", workspace.id, 0),
    ).rejects.toThrow("workspace_not_found");
  });
});

describe("idempotent turns", () => {
  test("returns the same turn for a repeated idempotency key and payload", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new WorkspaceService(store);
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const first = await service.beginTurn(
      "user-1",
      workspace.id,
      " turn-1 ",
      " message-1 ",
      "  Build Nextech  ",
    );
    const replay = await service.beginTurn(
      "user-1",
      workspace.id,
      "turn-1",
      "message-1",
      "Build Nextech",
    );

    expect(first.kind).toBe("created");
    expect(replay.kind).toBe("replay");
    expect(replay.turn.id).toBe(first.turn.id);
    expect(replay.turn.userMessage.content).toBe("Build Nextech");
    expect(replay.turn.userMessage.clientMessageId).toBe("message-1");
  });

  test("rejects reuse of an idempotency key with different content", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    await service.beginTurn(
      "user-1",
      workspace.id,
      "turn-1",
      "message-1",
      "Build Nextech",
    );

    await expect(
      service.beginTurn(
        "user-1",
        workspace.id,
        "turn-1",
        "message-1",
        "Build something else",
      ),
    ).rejects.toThrow("idempotency_conflict");
  });

  test("rejects reuse of an idempotency key with a different client message ID", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    await service.beginTurn(
      "user-1",
      workspace.id,
      "turn-1",
      "message-1",
      "Build Nextech",
    );

    await expect(
      service.beginTurn(
        "user-1",
        workspace.id,
        "turn-1",
        "message-2",
        "Build Nextech",
      ),
    ).rejects.toThrow("idempotency_conflict");
  });

  test("does not duplicate a user message or turn on replay", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new WorkspaceService(store);
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const first = await service.beginTurn(
      "user-1",
      workspace.id,
      "turn-1",
      "message-1",
      "Build Nextech",
    );
    await service.beginTurn(
      "user-1",
      workspace.id,
      "turn-1",
      "message-1",
      "Build Nextech",
    );

    const snapshot = await service.snapshot("user-1", workspace.id);
    const stored = await store.getTurn(workspace.id, "turn-1");
    expect(snapshot.messages.map((message) => message.id)).toEqual([
      first.turn.userMessage.id,
    ]);
    expect(stored?.id).toBe(first.turn.id);
  });

  test("rejects empty transition identifiers and message content", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");

    await expect(
      service.beginTurn("user-1", workspace.id, " ", "message-1", "Hello"),
    ).rejects.toThrow("idempotency_key_required");
    await expect(
      service.beginTurn("user-1", workspace.id, "turn-1", " ", "Hello"),
    ).rejects.toThrow("client_message_id_required");
    await expect(
      service.beginTurn("user-1", workspace.id, "turn-1", "message-1", " "),
    ).rejects.toThrow("message_content_required");
  });
});

describe("turn completion and failure", () => {
  test("completes a turn once without duplicating its assistant message", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new WorkspaceService(store);
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const { turn } = await service.beginTurn(
      "user-1",
      workspace.id,
      "turn-1",
      "message-1",
      "Build Nextech",
    );

    const completed = await service.completeTurn(
      "user-1",
      workspace.id,
      turn.id,
      "assistant-1",
      "  What audience is this for?  ",
    );
    const replay = await service.completeTurn(
      "user-1",
      workspace.id,
      turn.id,
      "assistant-1",
      "What audience is this for?",
    );

    expect(completed.status).toBe("completed");
    expect(completed.assistantMessage?.content).toBe(
      "What audience is this for?",
    );
    expect(replay.assistantMessage?.id).toBe(completed.assistantMessage?.id);
    expect((await service.snapshot("user-1", workspace.id)).messages).toHaveLength(
      2,
    );
  });

  test("marks a processing turn failed without creating an assistant message", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new WorkspaceService(store);
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const { turn } = await service.beginTurn(
      "user-1",
      workspace.id,
      "turn-1",
      "message-1",
      "Build Nextech",
    );

    await service.failTurn(
      "user-1",
      workspace.id,
      turn.id,
      " planner_unavailable ",
    );

    const failed = await store.getTurn(workspace.id, "turn-1");
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("planner_unavailable");
    expect(failed?.assistantMessage).toBeNull();
    expect((await service.snapshot("user-1", workspace.id)).messages).toHaveLength(
      1,
    );
  });

  test("rejects turn IDs that belong to another workspace", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const firstWorkspace = await service.createWorkspace("user-1", "First");
    const secondWorkspace = await service.createWorkspace("user-1", "Second");
    const { turn } = await service.beginTurn(
      "user-1",
      firstWorkspace.id,
      "turn-1",
      "message-1",
      "Build Nextech",
    );

    await expect(
      service.completeTurn(
        "user-1",
        secondWorkspace.id,
        turn.id,
        "assistant-1",
        "Question",
      ),
    ).rejects.toThrow("turn_not_found");
    await expect(
      service.failTurn(
        "user-1",
        secondWorkspace.id,
        turn.id,
        "planner_unavailable",
      ),
    ).rejects.toThrow("turn_not_found");
  });

  test("rejects empty completion content and failure codes", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const { turn } = await service.beginTurn(
      "user-1",
      workspace.id,
      "turn-1",
      "message-1",
      "Build Nextech",
    );

    await expect(
      service.completeTurn(
        "user-1",
        workspace.id,
        turn.id,
        "assistant-1",
        " ",
      ),
    ).rejects.toThrow("message_content_required");
    await expect(
      service.failTurn("user-1", workspace.id, turn.id, " "),
    ).rejects.toThrow("error_code_required");
  });
});

describe("draft specifications and atomic approval", () => {
  test("creates a draft with the selected version and canonical hash", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const input = draftSpec(workspace.id, 3);

    const saved = await service.saveDraftSpec("user-1", workspace.id, input);

    expect(saved.status).toBe("draft");
    expect(saved.version).toBe(3);
    expect(saved.hash).toBe(computeSpecHash(saved));
    expect((await service.snapshot("user-1", workspace.id)).activeSpec?.id).toBe(
      saved.id,
    );
  });

  test("rejects a draft whose embedded workspace ID crosses the boundary", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");

    await expect(
      service.saveDraftSpec("user-1", workspace.id, draftSpec("other-space")),
    ).rejects.toThrow("spec_workspace_mismatch");
  });

  test("rejects empty draft requests and non-positive versions", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");

    await expect(
      service.saveDraftSpec(
        "user-1",
        workspace.id,
        draftSpec(workspace.id, 1, { originalRequest: " " }),
      ),
    ).rejects.toThrow("original_request_required");
    await expect(
      service.saveDraftSpec("user-1", workspace.id, draftSpec(workspace.id, 0)),
    ).rejects.toThrow("spec_version_invalid");
  });

  test("approves the exact selected draft and creates one queued build run", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const first = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 1),
    );
    await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 2),
    );

    const approved = await service.approveSpecAndCreateRun(
      "user-1",
      workspace.id,
      first.id,
      first.hash,
      "approve-1",
    );

    expect(approved.replay).toBe(false);
    expect(approved.spec.id).toBe(first.id);
    expect(approved.spec.version).toBe(1);
    expect(approved.spec.hash).toBe(first.hash);
    expect(approved.spec.status).toBe("approved");
    expect(approved.spec.approvedBy).toBe("user-1");
    expect(approved.runId).toBeTruthy();
    expect((await service.snapshot("user-1", workspace.id)).activeRun).toEqual({
      id: approved.runId,
      status: "queued",
      specHash: first.hash,
    });
  });

  test("rejects a wrong hash before mutating the selected or prior approved spec", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const first = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 1),
    );
    const firstApproval = await service.approveSpecAndCreateRun(
      "user-1",
      workspace.id,
      first.id,
      first.hash,
      "approve-1",
    );
    const second = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 2),
    );

    await expect(
      service.approveSpecAndCreateRun(
        "user-1",
        workspace.id,
        second.id,
        "0".repeat(64),
        "approve-2",
      ),
    ).rejects.toThrow("spec_hash_mismatch");

    const snapshot = await service.snapshot("user-1", workspace.id);
    expect(snapshot.activeSpec?.id).toBe(first.id);
    expect(snapshot.activeSpec?.status).toBe("approved");
    expect(snapshot.activeRun?.id).toBe(firstApproval.runId);
  });

  test("supersedes the prior approved spec when a new exact version is approved", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const first = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 1),
    );
    await service.approveSpecAndCreateRun(
      "user-1",
      workspace.id,
      first.id,
      first.hash,
      "approve-1",
    );
    const second = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 2),
    );
    await service.approveSpecAndCreateRun(
      "user-1",
      workspace.id,
      second.id,
      second.hash,
      "approve-2",
    );

    expect((await service.snapshot("user-1", workspace.id)).activeSpec?.id).toBe(
      second.id,
    );
    await expect(
      service.approveSpecAndCreateRun(
        "user-1",
        workspace.id,
        first.id,
        first.hash,
        "approve-3",
      ),
    ).rejects.toThrow("spec_superseded");
  });

  test("replays the immutable approved view after a later version supersedes it", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const first = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 1),
    );
    const firstApproval = await service.approveSpecAndCreateRun(
      "user-1",
      workspace.id,
      first.id,
      first.hash,
      "approve-1",
    );
    const second = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 2),
    );
    await service.approveSpecAndCreateRun(
      "user-1",
      workspace.id,
      second.id,
      second.hash,
      "approve-2",
    );

    const replay = await service.approveSpecAndCreateRun(
      "user-1",
      workspace.id,
      first.id,
      first.hash,
      "approve-1",
    );

    expect(replay.replay).toBe(true);
    expect(replay.runId).toBe(firstApproval.runId);
    expect(replay.spec.status).toBe("approved");
    expect(replay.spec.id).toBe(first.id);
    expect(replay.spec.version).toBe(first.version);
    expect(replay.spec.hash).toBe(first.hash);
    expect(computeSpecHash(replay.spec)).toBe(replay.spec.hash);
  });

  test("replays one build run per approval key and rejects changed approval payloads", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const first = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 1),
    );
    const second = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 2),
    );
    const created = await service.approveSpecAndCreateRun(
      "user-1",
      workspace.id,
      first.id,
      first.hash,
      "approve-1",
    );

    const replay = await service.approveSpecAndCreateRun(
      "user-1",
      workspace.id,
      first.id,
      first.hash,
      "approve-1",
    );
    expect(replay.replay).toBe(true);
    expect(replay.runId).toBe(created.runId);
    await expect(
      service.approveSpecAndCreateRun(
        "user-1",
        workspace.id,
        second.id,
        second.hash,
        "approve-1",
      ),
    ).rejects.toThrow("idempotency_conflict");
  });

  test("serializes identical concurrent approval requests into one create and one replay", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const spec = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id),
    );

    const results = await Promise.all([
      service.approveSpecAndCreateRun(
        "user-1",
        workspace.id,
        spec.id,
        spec.hash,
        "approve-race",
      ),
      service.approveSpecAndCreateRun(
        "user-1",
        workspace.id,
        spec.id,
        spec.hash,
        "approve-race",
      ),
    ]);

    expect(results.map((result) => result.replay).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
  });

  test("turns conflicting concurrent approval payloads into idempotency_conflict", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const first = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 1),
    );
    const second = await service.saveDraftSpec(
      "user-1",
      workspace.id,
      draftSpec(workspace.id, 2),
    );

    const results = await Promise.allSettled([
      service.approveSpecAndCreateRun(
        "user-1",
        workspace.id,
        first.id,
        first.hash,
        "approve-race",
      ),
      service.approveSpecAndCreateRun(
        "user-1",
        workspace.id,
        second.id,
        second.hash,
        "approve-race",
      ),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason)).toContain("idempotency_conflict");
  });

  test("rejects a specification ID owned by another workspace", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const firstWorkspace = await service.createWorkspace("user-1", "First");
    const secondWorkspace = await service.createWorkspace("user-1", "Second");
    const spec = await service.saveDraftSpec(
      "user-1",
      firstWorkspace.id,
      draftSpec(firstWorkspace.id),
    );

    await expect(
      service.approveSpecAndCreateRun(
        "user-1",
        secondWorkspace.id,
        spec.id,
        spec.hash,
        "approve-1",
      ),
    ).rejects.toThrow("spec_not_found");
  });
});

describe("public activity events", () => {
  test("filters by workspace cursor and returns only public event fields", async () => {
    const store = new MemoryWorkspaceStore();
    const service = new WorkspaceService(store);
    const workspace = await service.createWorkspace("user-1", "Nextech");
    const first = event(workspace.id, randomUUID(), "Draft saved");
    const second = {
      ...event(workspace.id, randomUUID(), "Scope confirmed"),
      internalAgent: "hidden",
      rawCommand: "never public",
    };
    await store.appendEvent(workspace.id, first);
    await store.appendEvent(workspace.id, second);

    const page = await service.listEvents("user-1", workspace.id, 1);

    expect(page.cursor).toBe(2);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.id).toBe(second.id);
    expect(page.events[0]).not.toHaveProperty("cursor");
    expect(page.events[0]).not.toHaveProperty("internalAgent");
    expect(page.events[0]).not.toHaveProperty("rawCommand");
    expect((await service.listEvents("user-1", workspace.id, 2)).events).toEqual(
      [],
    );
  });

  test("does not expose another owner's events", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Private");

    await expect(
      service.listEvents("user-2", workspace.id, 0),
    ).rejects.toThrow("workspace_not_found");
  });

  test("normalizes invalid cursors to zero", async () => {
    const service = new WorkspaceService(new MemoryWorkspaceStore());
    const workspace = await service.createWorkspace("user-1", "Nextech");

    expect((await service.listEvents("user-1", workspace.id, -4)).cursor).toBe(0);
    expect(
      (await service.listEvents("user-1", workspace.id, Number.NaN)).cursor,
    ).toBe(0);
  });
});

test("postgres store source keeps approval atomic, locked, scoped, and conflict-aware", async () => {
  const source = await Bun.file(
    new URL("./postgres-store.ts", import.meta.url),
  ).text();

  expect(source).toContain(".transaction(");
  expect(source).toContain('.for("update")');
  expect(source).toContain("onConflictDoNothing");
  expect(source).toContain("workspaceSpecs.workspaceId");
  expect(source).toContain("workspaceSpecs.id");
  expect(source).toContain("workspaceTurns.workspaceId");
  expect(source).toContain("workspaceTurns.id");
  expect(source.indexOf('if (selected.hash !== expectedHash)')).toBeLessThan(
    source.indexOf('status: "superseded"'),
  );
});

const runPostgresIntegration =
  process.env.RUN_WORKSPACE_PG_INTEGRATION === "1";

test.skipIf(!runPostgresIntegration)(
  "postgres store proves conflict readback, exact approval, replay, and ownership in a rollback",
  async () => {
    const { db, projects, users } = await import("@nexsidi/db");
    const ownerId = randomUUID();
    const otherOwnerId = randomUUID();
    let workspaceId = "";

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(users).values([
          { id: ownerId, email: `${ownerId}@example.test`, name: "Owner" },
          { id: otherOwnerId, email: `${otherOwnerId}@example.test`, name: "Other Owner" },
        ]);
        const store = new PostgresWorkspaceStore(tx);
        const service = new WorkspaceService(store);
        const workspace = await service.createWorkspace(ownerId, "Live proof");
        workspaceId = workspace.id;

        const first = await service.beginTurn(
          ownerId,
          workspace.id,
          "turn-live",
          "message-live",
          "Build the live proof",
        );
        const replay = await service.beginTurn(
          ownerId,
          workspace.id,
          "turn-live",
          "message-live",
          "Build the live proof",
        );
        expect(replay.kind).toBe("replay");
        expect(replay.turn.id).toBe(first.turn.id);
        await expect(
          service.beginTurn(
            ownerId,
            workspace.id,
            "turn-live",
            "message-live",
            "Changed payload",
          ),
        ).rejects.toThrow("idempotency_conflict");

        const spec = await service.saveDraftSpec(
          ownerId,
          workspace.id,
          draftSpec(workspace.id),
        );
        await expect(
          service.approveSpecAndCreateRun(
            ownerId,
            workspace.id,
            spec.id,
            "0".repeat(64),
            "approve-live",
          ),
        ).rejects.toThrow("spec_hash_mismatch");
        const approved = await service.approveSpecAndCreateRun(
          ownerId,
          workspace.id,
          spec.id,
          spec.hash,
          "approve-live",
        );
        const approvalReplay = await service.approveSpecAndCreateRun(
          ownerId,
          workspace.id,
          spec.id,
          spec.hash,
          "approve-live",
        );
        expect(approvalReplay.replay).toBe(true);
        expect(approvalReplay.runId).toBe(approved.runId);
        const secondSpec = await service.saveDraftSpec(
          ownerId,
          workspace.id,
          draftSpec(workspace.id, 2),
        );
        await service.approveSpecAndCreateRun(
          ownerId,
          workspace.id,
          secondSpec.id,
          secondSpec.hash,
          "approve-live-2",
        );
        const supersededReplay = await service.approveSpecAndCreateRun(
          ownerId,
          workspace.id,
          spec.id,
          spec.hash,
          "approve-live",
        );
        expect(supersededReplay.replay).toBe(true);
        expect(supersededReplay.runId).toBe(approved.runId);
        expect(supersededReplay.spec.status).toBe("approved");
        expect(computeSpecHash(supersededReplay.spec)).toBe(spec.hash);
        await expect(service.snapshot(otherOwnerId, workspace.id)).rejects.toThrow(
          "workspace_not_found",
        );

        throw new Error("workspace_integration_rollback");
      }),
    ).rejects.toThrow("workspace_integration_rollback");

    const persisted = await db
      .select({ id: projects.id })
      .from(projects)
      .where((await import("drizzle-orm")).eq(projects.id, workspaceId));
    expect(persisted).toEqual([]);
  },
);

test.skipIf(!runPostgresIntegration)(
  "postgres approvals serialize identical and conflicting two-connection races",
  async () => {
    const { db, projects, users } = await import("@nexsidi/db");
    const { eq, inArray } = await import("drizzle-orm");
    const ownerId = randomUUID();
    const workspaceIds: string[] = [];

    try {
      await db
        .insert(users)
        .values({ id: ownerId, email: `${ownerId}@example.test`, name: "Owner" });
      const service = new WorkspaceService(new PostgresWorkspaceStore(db));

      const identicalWorkspace = await service.createWorkspace(
        ownerId,
        "Identical approval race",
      );
      workspaceIds.push(identicalWorkspace.id);
      const identicalSpec = await service.saveDraftSpec(
        ownerId,
        identicalWorkspace.id,
        draftSpec(identicalWorkspace.id),
      );
      const identical = await Promise.allSettled([
        service.approveSpecAndCreateRun(
          ownerId,
          identicalWorkspace.id,
          identicalSpec.id,
          identicalSpec.hash,
          "identical-race",
        ),
        service.approveSpecAndCreateRun(
          ownerId,
          identicalWorkspace.id,
          identicalSpec.id,
          identicalSpec.hash,
          "identical-race",
        ),
      ]);
      const identicalFulfilled = identical.filter(
        (result) => result.status === "fulfilled",
      );
      expect(identicalFulfilled).toHaveLength(2);
      if (
        identical[0]?.status !== "fulfilled" ||
        identical[1]?.status !== "fulfilled"
      ) {
        throw new Error(
          `identical_race_failed:${identical
            .filter((result) => result.status === "rejected")
            .map((result) => String(result.reason))
            .join("|")}`,
        );
      }
      expect(identicalFulfilled.map((result) => result.value.replay).sort()).toEqual([
        false,
        true,
      ]);
      expect(
        new Set(identicalFulfilled.map((result) => result.value.runId)).size,
      ).toBe(1);

      const conflictingWorkspace = await service.createWorkspace(
        ownerId,
        "Conflicting approval race",
      );
      workspaceIds.push(conflictingWorkspace.id);
      const first = await service.saveDraftSpec(
        ownerId,
        conflictingWorkspace.id,
        draftSpec(conflictingWorkspace.id, 1),
      );
      const second = await service.saveDraftSpec(
        ownerId,
        conflictingWorkspace.id,
        draftSpec(conflictingWorkspace.id, 2),
      );
      const conflicting = await Promise.allSettled([
        service.approveSpecAndCreateRun(
          ownerId,
          conflictingWorkspace.id,
          first.id,
          first.hash,
          "conflicting-race",
        ),
        service.approveSpecAndCreateRun(
          ownerId,
          conflictingWorkspace.id,
          second.id,
          second.hash,
          "conflicting-race",
        ),
      ]);
      const conflictingFulfilled = conflicting.filter(
        (result) => result.status === "fulfilled",
      );
      const conflictingRejected = conflicting.filter(
        (result) => result.status === "rejected",
      );
      expect(conflictingFulfilled).toHaveLength(1);
      expect(conflictingRejected).toHaveLength(1);
      expect(String(conflictingRejected[0]?.reason)).toContain(
        "idempotency_conflict",
      );
    } finally {
      if (workspaceIds.length > 0) {
        await db.delete(projects).where(inArray(projects.id, workspaceIds));
      }
      await db.delete(users).where(eq(users.id, ownerId));
    }
  },
);
