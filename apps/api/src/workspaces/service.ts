import { randomUUID } from "crypto";
import {
  assertApprovedSpec,
  computeSpecHash,
} from "@nexsidi/workspace-contract/spec";
import type { WorkspaceSpec } from "@nexsidi/workspace-contract/types";
import type { StoredTurn, WorkspaceStore } from "./store.ts";

export type DraftSpecInput = Omit<
  WorkspaceSpec,
  "hash" | "status" | "createdAt" | "approvedAt" | "approvedBy"
>;

function required(value: string, errorCode: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function sameTurnPayload(
  turn: StoredTurn,
  clientMessageId: string,
  content: string,
): boolean {
  return (
    turn.userMessage.clientMessageId === clientMessageId &&
    turn.userMessage.content === content
  );
}

export class WorkspaceService {
  constructor(private readonly store: WorkspaceStore) {}

  async createWorkspace(ownerId: string, name: string) {
    const normalizedOwnerId = required(ownerId, "owner_id_required");
    const normalizedName = name.trim() || "New Project";
    const id = randomUUID().replaceAll("-", "").slice(0, 12);
    return this.store.createWorkspace(normalizedOwnerId, id, normalizedName);
  }

  async snapshot(userId: string, workspaceId: string) {
    const normalizedWorkspaceId = workspaceId.trim();
    const snapshot = await this.store.getSnapshot(normalizedWorkspaceId);
    if (!snapshot || snapshot.ownerId !== userId) {
      throw new Error("workspace_not_found");
    }
    return snapshot;
  }

  async beginTurn(
    userId: string,
    workspaceId: string,
    idempotencyKey: string,
    clientMessageId: string,
    content: string,
  ) {
    const snapshot = await this.snapshot(userId, workspaceId);
    const normalizedKey = required(
      idempotencyKey,
      "idempotency_key_required",
    );
    const normalizedClientMessageId = required(
      clientMessageId,
      "client_message_id_required",
    );
    const normalizedContent = required(content, "message_content_required");
    const existing = await this.store.getTurn(snapshot.id, normalizedKey);
    if (existing) {
      if (
        !sameTurnPayload(
          existing,
          normalizedClientMessageId,
          normalizedContent,
        )
      ) {
        throw new Error("idempotency_conflict");
      }
      return { kind: "replay" as const, turn: existing };
    }

    const inserted = await this.store.insertTurn(
      snapshot.id,
      normalizedKey,
      normalizedClientMessageId,
      normalizedContent,
    );
    if (
      !sameTurnPayload(
        inserted.turn,
        normalizedClientMessageId,
        normalizedContent,
      )
    ) {
      throw new Error("idempotency_conflict");
    }
    return {
      kind: inserted.replay ? ("replay" as const) : ("created" as const),
      turn: inserted.turn,
    };
  }

  async completeTurn(
    userId: string,
    workspaceId: string,
    turnId: string,
    assistantClientMessageId: string,
    content: string,
  ) {
    const snapshot = await this.snapshot(userId, workspaceId);
    const normalizedTurnId = required(turnId, "turn_id_required");
    const normalizedClientMessageId = required(
      assistantClientMessageId,
      "client_message_id_required",
    );
    const normalizedContent = required(content, "message_content_required");
    return this.store.completeTurn(
      snapshot.id,
      normalizedTurnId,
      normalizedClientMessageId,
      normalizedContent,
    );
  }

  async failTurn(
    userId: string,
    workspaceId: string,
    turnId: string,
    errorCode: string,
  ) {
    const snapshot = await this.snapshot(userId, workspaceId);
    return this.store.failTurn(
      snapshot.id,
      required(turnId, "turn_id_required"),
      required(errorCode, "error_code_required"),
    );
  }

  async saveDraftSpec(
    userId: string,
    workspaceId: string,
    input: DraftSpecInput,
  ) {
    const snapshot = await this.snapshot(userId, workspaceId);
    if (input.workspaceId !== snapshot.id) {
      throw new Error("spec_workspace_mismatch");
    }
    if (!Number.isInteger(input.version) || input.version <= 0) {
      throw new Error("spec_version_invalid");
    }
    const normalized: DraftSpecInput = {
      ...input,
      id: required(input.id, "spec_id_required"),
      originalRequest: required(
        input.originalRequest,
        "original_request_required",
      ),
    };
    const createdAt = new Date().toISOString();
    const withoutHash = {
      ...normalized,
      status: "draft" as const,
      createdAt,
    };
    const spec: WorkspaceSpec = {
      ...withoutHash,
      hash: computeSpecHash(withoutHash),
    };
    return this.store.insertDraftSpec(snapshot.id, spec);
  }

  async approveSpecAndCreateRun(
    userId: string,
    workspaceId: string,
    specId: string,
    expectedHash: string,
    idempotencyKey: string,
  ) {
    const snapshot = await this.snapshot(userId, workspaceId);
    const result = await this.store.approveSpecAndInsertRun(
      snapshot.id,
      required(specId, "spec_id_required"),
      userId,
      required(expectedHash, "spec_hash_required"),
      required(idempotencyKey, "idempotency_key_required"),
    );
    assertApprovedSpec(result.spec);
    return result;
  }

  async listEvents(userId: string, workspaceId: string, after: number) {
    const snapshot = await this.snapshot(userId, workspaceId);
    const cursor = Number.isFinite(after) && after > 0 ? Math.floor(after) : 0;
    return this.store.listEvents(snapshot.id, cursor);
  }
}
