import { randomUUID } from "crypto";
import type {
  PublicActivityEvent,
  WorkspaceMessage,
  WorkspacePhase,
  WorkspaceSnapshot,
  WorkspaceSpec,
} from "@nexsidi/workspace-contract/types";
import type {
  ApprovalResult,
  InsertTurnResult,
  StoredTurn,
  WorkspaceStore,
} from "./store.ts";

interface StoredWorkspace {
  id: string;
  ownerId: string;
  name: string;
  phase: WorkspacePhase;
}

interface StoredRun {
  id: string;
  workspaceId: string;
  specId: string;
  specVersion: number;
  specHash: string;
  idempotencyKey: string;
  status: string;
  createdAt: string;
}

interface StoredEvent {
  cursor: number;
  event: PublicActivityEvent;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function key(workspaceId: string, value: string): string {
  return `${workspaceId}\u0000${value}`;
}

function publicEvent(event: PublicActivityEvent): PublicActivityEvent {
  return {
    id: event.id,
    workspaceId: event.workspaceId,
    runId: event.runId,
    category: event.category,
    status: event.status,
    summary: event.summary,
    ...(event.safePath === undefined ? {} : { safePath: event.safePath }),
    ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
    ...(event.evidenceId === undefined ? {} : { evidenceId: event.evidenceId }),
    createdAt: event.createdAt,
  };
}

export class MemoryWorkspaceStore implements WorkspaceStore {
  private readonly workspaces = new Map<string, StoredWorkspace>();
  private readonly messages = new Map<string, WorkspaceMessage[]>();
  private readonly turnsByKey = new Map<string, StoredTurn>();
  private readonly turnsById = new Map<string, StoredTurn>();
  private readonly specs = new Map<string, Map<string, WorkspaceSpec>>();
  private readonly runsByKey = new Map<string, StoredRun>();
  private readonly runs = new Map<string, StoredRun>();
  private readonly events = new Map<string, StoredEvent[]>();
  private nextEventCursor = 1;

  async createWorkspace(
    ownerId: string,
    id: string,
    name: string,
  ): Promise<WorkspaceSnapshot> {
    if (this.workspaces.has(id)) throw new Error("workspace_conflict");
    this.workspaces.set(id, { id, ownerId, name, phase: "intake" });
    this.messages.set(id, []);
    this.specs.set(id, new Map());
    this.events.set(id, []);
    const snapshot = await this.getSnapshot(id);
    if (!snapshot) throw new Error("workspace_not_found");
    return snapshot;
  }

  async getSnapshot(workspaceId: string): Promise<WorkspaceSnapshot | null> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;
    const workspaceSpecs = [...(this.specs.get(workspaceId)?.values() ?? [])];
    const activeSpec =
      workspaceSpecs.find((spec) => spec.status === "approved") ??
      workspaceSpecs
        .filter((spec) => spec.status === "draft")
        .sort((left, right) => right.version - left.version)[0] ??
      null;
    const activeRun = [...this.runs.values()]
      .filter((run) => run.workspaceId === workspaceId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const workspaceEvents = this.events.get(workspaceId) ?? [];

    return clone({
      id: workspace.id,
      ownerId: workspace.ownerId,
      name: workspace.name,
      phase: workspace.phase,
      messages: this.messages.get(workspaceId) ?? [],
      activeSpec,
      activeRun: activeRun
        ? {
            id: activeRun.id,
            status: activeRun.status,
            specHash: activeRun.specHash,
          }
        : null,
      eventCursor: workspaceEvents.at(-1)?.cursor ?? 0,
    });
  }

  async getTurn(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<StoredTurn | null> {
    const turn = this.turnsByKey.get(key(workspaceId, idempotencyKey));
    return turn ? clone(turn) : null;
  }

  async insertTurn(
    workspaceId: string,
    idempotencyKey: string,
    clientMessageId: string,
    content: string,
  ): Promise<InsertTurnResult> {
    if (!this.workspaces.has(workspaceId)) throw new Error("workspace_not_found");
    const turnKey = key(workspaceId, idempotencyKey);
    const existing = this.turnsByKey.get(turnKey);
    if (existing) return { turn: clone(existing), replay: true };
    const workspaceMessages = this.messages.get(workspaceId) ?? [];
    const reusedMessage = workspaceMessages.find(
      (message) => message.clientMessageId === clientMessageId,
    );
    if (reusedMessage) throw new Error("idempotency_conflict");

    const now = new Date().toISOString();
    const userMessage: WorkspaceMessage = {
      id: randomUUID(),
      workspaceId,
      role: "user",
      content,
      clientMessageId,
      createdAt: now,
    };
    const turn: StoredTurn = {
      id: randomUUID(),
      workspaceId,
      idempotencyKey,
      status: "processing",
      userMessage,
      assistantMessage: null,
      errorCode: null,
    };
    workspaceMessages.push(userMessage);
    this.messages.set(workspaceId, workspaceMessages);
    this.turnsByKey.set(turnKey, turn);
    this.turnsById.set(turn.id, turn);
    return { turn: clone(turn), replay: false };
  }

  async completeTurn(
    workspaceId: string,
    turnId: string,
    assistantClientMessageId: string,
    content: string,
  ): Promise<StoredTurn> {
    const turn = this.turnsById.get(turnId);
    if (!turn || turn.workspaceId !== workspaceId) {
      throw new Error("turn_not_found");
    }
    if (turn.status === "completed") {
      if (
        turn.assistantMessage?.clientMessageId !== assistantClientMessageId ||
        turn.assistantMessage.content !== content
      ) {
        throw new Error("idempotency_conflict");
      }
      return clone(turn);
    }
    if (turn.status !== "processing") throw new Error("turn_not_processing");
    const workspaceMessages = this.messages.get(workspaceId) ?? [];
    if (
      workspaceMessages.some(
        (message) => message.clientMessageId === assistantClientMessageId,
      )
    ) {
      throw new Error("idempotency_conflict");
    }
    const assistantMessage: WorkspaceMessage = {
      id: randomUUID(),
      workspaceId,
      role: "assistant",
      content,
      clientMessageId: assistantClientMessageId,
      createdAt: new Date().toISOString(),
    };
    workspaceMessages.push(assistantMessage);
    turn.status = "completed";
    turn.assistantMessage = assistantMessage;
    turn.errorCode = null;
    return clone(turn);
  }

  async failTurn(
    workspaceId: string,
    turnId: string,
    errorCode: string,
  ): Promise<void> {
    const turn = this.turnsById.get(turnId);
    if (!turn || turn.workspaceId !== workspaceId) {
      throw new Error("turn_not_found");
    }
    if (turn.status === "failed") {
      if (turn.errorCode !== errorCode) throw new Error("idempotency_conflict");
      return;
    }
    if (turn.status !== "processing") throw new Error("turn_not_processing");
    turn.status = "failed";
    turn.errorCode = errorCode;
  }

  async insertDraftSpec(
    workspaceId: string,
    spec: WorkspaceSpec,
  ): Promise<WorkspaceSpec> {
    const workspaceSpecs = this.specs.get(workspaceId);
    if (!workspaceSpecs) throw new Error("workspace_not_found");
    if (spec.workspaceId !== workspaceId) {
      throw new Error("spec_workspace_mismatch");
    }
    const existingById = workspaceSpecs.get(spec.id);
    if (existingById) {
      if (existingById.hash === spec.hash && existingById.version === spec.version) {
        return clone(existingById);
      }
      throw new Error("spec_conflict");
    }
    if ([...workspaceSpecs.values()].some((item) => item.version === spec.version)) {
      throw new Error("spec_version_conflict");
    }
    workspaceSpecs.set(spec.id, clone(spec));
    return clone(spec);
  }

  async approveSpecAndInsertRun(
    workspaceId: string,
    specId: string,
    userId: string,
    expectedHash: string,
    idempotencyKey: string,
  ): Promise<ApprovalResult> {
    const workspaceSpecs = this.specs.get(workspaceId);
    if (!workspaceSpecs) throw new Error("workspace_not_found");
    const runKey = key(workspaceId, idempotencyKey);
    const existingRun = this.runsByKey.get(runKey);
    if (existingRun) {
      if (
        existingRun.specId !== specId ||
        existingRun.specHash !== expectedHash
      ) {
        throw new Error("idempotency_conflict");
      }
      const replaySpec = workspaceSpecs.get(existingRun.specId);
      if (!replaySpec) throw new Error("spec_not_found");
      return { spec: clone(replaySpec), runId: existingRun.id, replay: true };
    }

    const selected = workspaceSpecs.get(specId);
    if (!selected) throw new Error("spec_not_found");
    if (selected.hash !== expectedHash) throw new Error("spec_hash_mismatch");
    if (selected.status === "superseded") throw new Error("spec_superseded");
    if (selected.status !== "draft") throw new Error("spec_not_draft");

    const approvedAt = new Date().toISOString();
    for (const spec of workspaceSpecs.values()) {
      if (spec.status === "approved") {
        spec.status = "superseded";
      }
    }
    selected.status = "approved";
    selected.approvedAt = approvedAt;
    selected.approvedBy = userId;
    const run: StoredRun = {
      id: randomUUID(),
      workspaceId,
      specId: selected.id,
      specVersion: selected.version,
      specHash: selected.hash,
      idempotencyKey,
      status: "queued",
      createdAt: approvedAt,
    };
    this.runsByKey.set(runKey, run);
    this.runs.set(run.id, run);
    const workspace = this.workspaces.get(workspaceId);
    if (workspace) workspace.phase = "approved";
    return { spec: clone(selected), runId: run.id, replay: false };
  }

  async appendEvent(
    workspaceId: string,
    input: PublicActivityEvent,
  ): Promise<number> {
    const workspaceEvents = this.events.get(workspaceId);
    if (!workspaceEvents) throw new Error("workspace_not_found");
    if (input.workspaceId !== workspaceId) throw new Error("event_workspace_mismatch");
    const cursor = this.nextEventCursor;
    this.nextEventCursor += 1;
    workspaceEvents.push({ cursor, event: publicEvent(input) });
    return cursor;
  }

  async listEvents(
    workspaceId: string,
    after: number,
  ): Promise<{ events: PublicActivityEvent[]; cursor: number }> {
    const workspaceEvents = this.events.get(workspaceId);
    if (!workspaceEvents) throw new Error("workspace_not_found");
    return {
      events: workspaceEvents
        .filter((item) => item.cursor > after)
        .map((item) => clone(item.event)),
      cursor: Math.max(after, workspaceEvents.at(-1)?.cursor ?? 0),
    };
  }
}
