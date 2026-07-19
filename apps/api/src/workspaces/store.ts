import type {
  PublicActivityEvent,
  WorkspaceMessage,
  WorkspaceSnapshot,
  WorkspaceSpec,
} from "@nexsidi/workspace-contract/types";

export interface StoredTurn {
  id: string;
  workspaceId: string;
  idempotencyKey: string;
  status: "processing" | "completed" | "failed";
  userMessage: WorkspaceMessage;
  assistantMessage: WorkspaceMessage | null;
  errorCode: string | null;
}

export interface InsertTurnResult {
  turn: StoredTurn;
  replay: boolean;
}

export interface ApprovalResult {
  spec: WorkspaceSpec;
  runId: string;
  replay: boolean;
}

export interface WorkspaceStore {
  createWorkspace(
    ownerId: string,
    id: string,
    name: string,
  ): Promise<WorkspaceSnapshot>;
  getSnapshot(workspaceId: string): Promise<WorkspaceSnapshot | null>;
  getTurn(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<StoredTurn | null>;
  insertTurn(
    workspaceId: string,
    idempotencyKey: string,
    clientMessageId: string,
    content: string,
  ): Promise<InsertTurnResult>;
  completeTurn(
    workspaceId: string,
    turnId: string,
    assistantClientMessageId: string,
    content: string,
  ): Promise<StoredTurn>;
  failTurn(
    workspaceId: string,
    turnId: string,
    errorCode: string,
  ): Promise<void>;
  insertDraftSpec(
    workspaceId: string,
    spec: WorkspaceSpec,
  ): Promise<WorkspaceSpec>;
  approveSpecAndInsertRun(
    workspaceId: string,
    specId: string,
    userId: string,
    expectedHash: string,
    idempotencyKey: string,
  ): Promise<ApprovalResult>;
  listEvents(
    workspaceId: string,
    after: number,
  ): Promise<{ events: PublicActivityEvent[]; cursor: number }>;
}
