import {
  and,
  asc,
  desc,
  eq,
  gt,
  max,
  ne,
} from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { DB } from "@nexsidi/db/client";
import {
  buildRuns,
  projects,
  workspaceEvents,
  workspaceMessages,
  workspaceSpecs,
  workspaceTurns,
} from "@nexsidi/db/schema";
import * as databaseSchema from "@nexsidi/db/schema";
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

type WorkspaceTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof databaseSchema,
  ExtractTablesWithRelations<typeof databaseSchema>
>;
type WorkspaceDatabase = DB | WorkspaceTransaction;
type MessageRow = typeof workspaceMessages.$inferSelect;
type TurnRow = typeof workspaceTurns.$inferSelect;
type SpecRow = typeof workspaceSpecs.$inferSelect;
type RunRow = typeof buildRuns.$inferSelect;

class TurnInsertRace extends Error {}
class ApprovalInsertRace extends Error {}

function iso(value: Date): string {
  return value.toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function toMessage(row: MessageRow): WorkspaceMessage {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    clientMessageId: row.clientMessageId,
    createdAt: iso(row.createdAt),
  };
}

function toSpec(row: SpecRow): WorkspaceSpec {
  const body = row.body as WorkspaceSpec;
  const status =
    row.status === "approved" || row.status === "superseded"
      ? row.status
      : "draft";
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    version: row.version,
    hash: row.hash,
    status,
    originalRequest: body.originalRequest,
    confirmedFacts: clone(body.confirmedFacts),
    questions: clone(body.questions),
    assumptions: clone(body.assumptions),
    scope: clone(body.scope),
    userJourneys: clone(body.userJourneys),
    pages: clone(body.pages),
    dataModel: clone(body.dataModel),
    apiContracts: clone(body.apiContracts),
    auth: clone(body.auth),
    design: clone(body.design),
    sources: clone(body.sources),
    acceptanceCriteria: clone(body.acceptanceCriteria),
    createdAt: iso(row.createdAt),
    ...(row.approvedAt ? { approvedAt: iso(row.approvedAt) } : {}),
    ...(row.approvedBy ? { approvedBy: row.approvedBy } : {}),
  };
}

function approvedReplaySpec(row: SpecRow, run: RunRow): WorkspaceSpec {
  if (
    row.id !== run.specId ||
    row.version !== run.specVersion ||
    row.hash !== run.specHash ||
    !row.approvedAt ||
    !row.approvedBy
  ) {
    throw new Error("approval_record_mismatch");
  }
  return {
    ...toSpec(row),
    status: "approved",
    approvedAt: iso(row.approvedAt),
    approvedBy: row.approvedBy,
  };
}

function toPhase(status: string): WorkspacePhase {
  const phases = new Set<WorkspacePhase>([
    "intake",
    "clarifying",
    "plan_ready",
    "approved",
    "building",
    "verifying",
    "blocked",
    "delivered",
    "cancelled",
  ]);
  if (phases.has(status as WorkspacePhase)) return status as WorkspacePhase;
  if (status === "completed") return "delivered";
  return "intake";
}

async function loadTurn(
  database: WorkspaceDatabase,
  workspaceId: string,
  row: TurnRow,
): Promise<StoredTurn> {
  const [userMessage] = await database
    .select()
    .from(workspaceMessages)
    .where(
      and(
        eq(workspaceMessages.workspaceId, workspaceId),
        eq(workspaceMessages.id, row.userMessageId),
      ),
    )
    .limit(1);
  if (!userMessage) throw new Error("turn_message_not_found");
  const [assistantMessage] = row.assistantMessageId
    ? await database
        .select()
        .from(workspaceMessages)
        .where(
          and(
            eq(workspaceMessages.workspaceId, workspaceId),
            eq(workspaceMessages.id, row.assistantMessageId),
          ),
        )
        .limit(1)
    : [];
  const status =
    row.status === "completed" || row.status === "failed"
      ? row.status
      : "processing";
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    idempotencyKey: row.idempotencyKey,
    status,
    userMessage: toMessage(userMessage),
    assistantMessage: assistantMessage ? toMessage(assistantMessage) : null,
    errorCode: row.errorCode,
  };
}

async function findTurnByKey(
  database: WorkspaceDatabase,
  workspaceId: string,
  idempotencyKey: string,
): Promise<StoredTurn | null> {
  const [row] = await database
    .select()
    .from(workspaceTurns)
    .where(
      and(
        eq(workspaceTurns.workspaceId, workspaceId),
        eq(workspaceTurns.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return row ? loadTurn(database, workspaceId, row) : null;
}

async function findRunByKey(
  database: WorkspaceDatabase,
  workspaceId: string,
  idempotencyKey: string,
): Promise<RunRow | null> {
  const [row] = await database
    .select()
    .from(buildRuns)
    .where(
      and(
        eq(buildRuns.workspaceId, workspaceId),
        eq(buildRuns.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findSpec(
  database: WorkspaceDatabase,
  workspaceId: string,
  specId: string,
): Promise<SpecRow | null> {
  const [row] = await database
    .select()
    .from(workspaceSpecs)
    .where(
      and(
        eq(workspaceSpecs.workspaceId, workspaceId),
        eq(workspaceSpecs.id, specId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export class PostgresWorkspaceStore implements WorkspaceStore {
  constructor(private readonly db: WorkspaceDatabase) {}

  async createWorkspace(
    ownerId: string,
    id: string,
    name: string,
  ): Promise<WorkspaceSnapshot> {
    await this.db.insert(projects).values({
      id,
      userId: ownerId,
      name,
      status: "intake",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const snapshot = await this.getSnapshot(id);
    if (!snapshot) throw new Error("workspace_not_found");
    return snapshot;
  }

  async getSnapshot(workspaceId: string): Promise<WorkspaceSnapshot | null> {
    const [workspace] = await this.db
      .select({
        id: projects.id,
        ownerId: projects.userId,
        name: projects.name,
        status: projects.status,
      })
      .from(projects)
      .where(eq(projects.id, workspaceId))
      .limit(1);
    if (!workspace) return null;

    const messageRows = await this.db
      .select()
      .from(workspaceMessages)
      .where(eq(workspaceMessages.workspaceId, workspaceId))
      .orderBy(asc(workspaceMessages.createdAt), asc(workspaceMessages.id));
    const specRows = await this.db
      .select()
      .from(workspaceSpecs)
      .where(eq(workspaceSpecs.workspaceId, workspaceId))
      .orderBy(desc(workspaceSpecs.version));
    const activeSpecRow =
      specRows.find((spec) => spec.status === "approved") ??
      specRows.find((spec) => spec.status === "draft") ??
      null;
    const [activeRun] = await this.db
      .select()
      .from(buildRuns)
      .where(eq(buildRuns.workspaceId, workspaceId))
      .orderBy(desc(buildRuns.createdAt), desc(buildRuns.id))
      .limit(1);
    const [cursorRow] = await this.db
      .select({ cursor: max(workspaceEvents.cursor) })
      .from(workspaceEvents)
      .where(eq(workspaceEvents.workspaceId, workspaceId));

    return {
      id: workspace.id,
      ownerId: workspace.ownerId,
      name: workspace.name,
      phase: toPhase(workspace.status),
      messages: messageRows.map(toMessage),
      activeSpec: activeSpecRow ? toSpec(activeSpecRow) : null,
      activeRun: activeRun
        ? {
            id: activeRun.id,
            status: activeRun.status,
            specHash: activeRun.specHash,
          }
        : null,
      eventCursor: Number(cursorRow?.cursor ?? 0),
    };
  }

  getTurn(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<StoredTurn | null> {
    return findTurnByKey(this.db, workspaceId, idempotencyKey);
  }

  async insertTurn(
    workspaceId: string,
    idempotencyKey: string,
    clientMessageId: string,
    content: string,
  ): Promise<InsertTurnResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const existing = await findTurnByKey(
          tx,
          workspaceId,
          idempotencyKey,
        );
        if (existing) return { turn: existing, replay: true };

        const [insertedMessage] = await tx
          .insert(workspaceMessages)
          .values({
            workspaceId,
            role: "user",
            content,
            clientMessageId,
          })
          .onConflictDoNothing({
            target: [
              workspaceMessages.workspaceId,
              workspaceMessages.clientMessageId,
            ],
          })
          .returning();
        if (!insertedMessage) {
          const [reusedMessage] = await tx
            .select()
            .from(workspaceMessages)
            .where(
              and(
                eq(workspaceMessages.workspaceId, workspaceId),
                eq(workspaceMessages.clientMessageId, clientMessageId),
              ),
            )
            .limit(1);
          if (reusedMessage) {
            const [reusedTurn] = await tx
              .select()
              .from(workspaceTurns)
              .where(
                and(
                  eq(workspaceTurns.workspaceId, workspaceId),
                  eq(workspaceTurns.userMessageId, reusedMessage.id),
                ),
              )
              .limit(1);
            if (reusedTurn?.idempotencyKey === idempotencyKey) {
              return {
                turn: await loadTurn(tx, workspaceId, reusedTurn),
                replay: true,
              };
            }
          }
          throw new Error("idempotency_conflict");
        }

        const [insertedTurn] = await tx
          .insert(workspaceTurns)
          .values({
            workspaceId,
            idempotencyKey,
            status: "processing",
            userMessageId: insertedMessage.id,
          })
          .onConflictDoNothing({
            target: [workspaceTurns.workspaceId, workspaceTurns.idempotencyKey],
          })
          .returning();
        if (!insertedTurn) throw new TurnInsertRace();
        return {
          turn: await loadTurn(tx, workspaceId, insertedTurn),
          replay: false,
        };
      });
    } catch (error) {
      if (!(error instanceof TurnInsertRace)) throw error;
      const existing = await findTurnByKey(
        this.db,
        workspaceId,
        idempotencyKey,
      );
      if (!existing) throw new Error("turn_insert_conflict");
      return { turn: existing, replay: true };
    }
  }

  async completeTurn(
    workspaceId: string,
    turnId: string,
    assistantClientMessageId: string,
    content: string,
  ): Promise<StoredTurn> {
    return this.db.transaction(async (tx) => {
      const [selected] = await tx
        .select()
        .from(workspaceTurns)
        .where(
          and(
            eq(workspaceTurns.workspaceId, workspaceId),
            eq(workspaceTurns.id, turnId),
          ),
        )
        .for("update")
        .limit(1);
      if (!selected) throw new Error("turn_not_found");
      if (selected.status === "completed") {
        const completed = await loadTurn(tx, workspaceId, selected);
        if (
          completed.assistantMessage?.clientMessageId !==
            assistantClientMessageId ||
          completed.assistantMessage.content !== content
        ) {
          throw new Error("idempotency_conflict");
        }
        return completed;
      }
      if (selected.status !== "processing") {
        throw new Error("turn_not_processing");
      }

      const [assistantMessage] = await tx
        .insert(workspaceMessages)
        .values({
          workspaceId,
          role: "assistant",
          content,
          clientMessageId: assistantClientMessageId,
        })
        .onConflictDoNothing({
          target: [
            workspaceMessages.workspaceId,
            workspaceMessages.clientMessageId,
          ],
        })
        .returning();
      if (!assistantMessage) throw new Error("idempotency_conflict");
      const [updated] = await tx
        .update(workspaceTurns)
        .set({
          status: "completed",
          assistantMessageId: assistantMessage.id,
          errorCode: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaceTurns.workspaceId, workspaceId),
            eq(workspaceTurns.id, turnId),
            eq(workspaceTurns.status, "processing"),
          ),
        )
        .returning();
      if (!updated) throw new Error("turn_not_processing");
      return loadTurn(tx, workspaceId, updated);
    });
  }

  async failTurn(
    workspaceId: string,
    turnId: string,
    errorCode: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [selected] = await tx
        .select()
        .from(workspaceTurns)
        .where(
          and(
            eq(workspaceTurns.workspaceId, workspaceId),
            eq(workspaceTurns.id, turnId),
          ),
        )
        .for("update")
        .limit(1);
      if (!selected) throw new Error("turn_not_found");
      if (selected.status === "failed") {
        if (selected.errorCode !== errorCode) {
          throw new Error("idempotency_conflict");
        }
        return;
      }
      if (selected.status !== "processing") {
        throw new Error("turn_not_processing");
      }
      await tx
        .update(workspaceTurns)
        .set({ status: "failed", errorCode, updatedAt: new Date() })
        .where(
          and(
            eq(workspaceTurns.workspaceId, workspaceId),
            eq(workspaceTurns.id, turnId),
            eq(workspaceTurns.status, "processing"),
          ),
        );
    });
  }

  async insertDraftSpec(
    workspaceId: string,
    spec: WorkspaceSpec,
  ): Promise<WorkspaceSpec> {
    const [inserted] = await this.db
      .insert(workspaceSpecs)
      .values({
        id: spec.id,
        workspaceId,
        version: spec.version,
        hash: spec.hash,
        status: "draft",
        body: spec,
        createdAt: new Date(spec.createdAt),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return toSpec(inserted);

    const existingById = await findSpec(this.db, workspaceId, spec.id);
    if (
      existingById?.status === "draft" &&
      existingById.hash === spec.hash &&
      existingById.version === spec.version
    ) {
      return toSpec(existingById);
    }
    const [existingVersion] = await this.db
      .select({ id: workspaceSpecs.id })
      .from(workspaceSpecs)
      .where(
        and(
          eq(workspaceSpecs.workspaceId, workspaceId),
          eq(workspaceSpecs.version, spec.version),
        ),
      )
      .limit(1);
    if (existingVersion) throw new Error("spec_version_conflict");
    throw new Error("spec_conflict");
  }

  async approveSpecAndInsertRun(
    workspaceId: string,
    specId: string,
    userId: string,
    expectedHash: string,
    idempotencyKey: string,
  ): Promise<ApprovalResult> {
    try {
      return await this.db.transaction(async (tx) => {
        const [lockedWorkspace] = await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, workspaceId))
          .for("update")
          .limit(1);
        if (!lockedWorkspace) throw new Error("workspace_not_found");

        const existingRun = await findRunByKey(
          tx,
          workspaceId,
          idempotencyKey,
        );
        if (existingRun) {
          if (
            existingRun.specId !== specId ||
            existingRun.specHash !== expectedHash
          ) {
            throw new Error("idempotency_conflict");
          }
          const replaySpec = await findSpec(tx, workspaceId, specId);
          if (!replaySpec) throw new Error("spec_not_found");
          return {
            spec: approvedReplaySpec(replaySpec, existingRun),
            runId: existingRun.id,
            replay: true,
          };
        }

        const [selected] = await tx
          .select()
          .from(workspaceSpecs)
          .where(
            and(
              eq(workspaceSpecs.workspaceId, workspaceId),
              eq(workspaceSpecs.id, specId),
            ),
          )
          .for("update")
          .limit(1);
        if (!selected) throw new Error("spec_not_found");
        if (selected.hash !== expectedHash) {
          throw new Error("spec_hash_mismatch");
        }
        if (selected.status === "superseded") {
          throw new Error("spec_superseded");
        }
        if (selected.status !== "draft") throw new Error("spec_not_draft");

        await tx
          .update(workspaceSpecs)
          .set({ status: "superseded" })
          .where(
            and(
              eq(workspaceSpecs.workspaceId, workspaceId),
              eq(workspaceSpecs.status, "approved"),
              ne(workspaceSpecs.id, specId),
            ),
          );
        const approvedAt = new Date();
        const [approved] = await tx
          .update(workspaceSpecs)
          .set({ status: "approved", approvedAt, approvedBy: userId })
          .where(
            and(
              eq(workspaceSpecs.workspaceId, workspaceId),
              eq(workspaceSpecs.id, specId),
              eq(workspaceSpecs.status, "draft"),
            ),
          )
          .returning();
        if (!approved) throw new Error("spec_not_draft");
        const [run] = await tx
          .insert(buildRuns)
          .values({
            workspaceId,
            specId: approved.id,
            specVersion: approved.version,
            specHash: approved.hash,
            idempotencyKey,
            status: "queued",
          })
          .onConflictDoNothing({
            target: [buildRuns.workspaceId, buildRuns.idempotencyKey],
          })
          .returning();
        if (!run) throw new ApprovalInsertRace();
        await tx
          .update(projects)
          .set({ status: "approved", updatedAt: new Date() })
          .where(eq(projects.id, workspaceId));
        return { spec: toSpec(approved), runId: run.id, replay: false };
      });
    } catch (error) {
      if (!(error instanceof ApprovalInsertRace)) throw error;
      const existingRun = await findRunByKey(
        this.db,
        workspaceId,
        idempotencyKey,
      );
      if (!existingRun) throw new Error("approval_insert_conflict");
      if (
        existingRun.specId !== specId ||
        existingRun.specHash !== expectedHash
      ) {
        throw new Error("idempotency_conflict");
      }
      const replaySpec = await findSpec(this.db, workspaceId, specId);
      if (!replaySpec) throw new Error("spec_not_found");
      return {
        spec: approvedReplaySpec(replaySpec, existingRun),
        runId: existingRun.id,
        replay: true,
      };
    }
  }

  async listEvents(
    workspaceId: string,
    after: number,
  ): Promise<{ events: PublicActivityEvent[]; cursor: number }> {
    const rows = await this.db
      .select()
      .from(workspaceEvents)
      .where(
        and(
          eq(workspaceEvents.workspaceId, workspaceId),
          gt(workspaceEvents.cursor, after),
        ),
      )
      .orderBy(asc(workspaceEvents.cursor));
    const [cursorRow] = await this.db
      .select({ cursor: max(workspaceEvents.cursor) })
      .from(workspaceEvents)
      .where(eq(workspaceEvents.workspaceId, workspaceId));
    return {
      events: rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        runId: row.runId,
        category: row.category as PublicActivityEvent["category"],
        status: row.status as PublicActivityEvent["status"],
        summary: row.summary,
        ...(row.safePath === null ? {} : { safePath: row.safePath }),
        ...(row.elapsedMs === null ? {} : { elapsedMs: row.elapsedMs }),
        ...(row.evidenceId === null ? {} : { evidenceId: row.evidenceId }),
        createdAt: iso(row.createdAt),
      })),
      cursor: Math.max(after, Number(cursorRow?.cursor ?? 0)),
    };
  }
}
