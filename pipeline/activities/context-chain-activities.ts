// Wires Patent Claims 1/3/7 (SHA-256 hash chain + RSA-SHA256 signing +
// automatic rollback on mismatch — packages/context-chain) into the real
// Temporal pipeline. Confirmed live 2026-07-25/26 (audit-2026-07-25.md):
// the crypto primitives existed and were tested (bun test
// packages/context-chain: 4/4 pass) but NOTHING called them — a repo-wide
// grep for "contextChain|context_chain" outside schema.ts returned zero
// files, and `select count(*) from context_chain` was 0 after 9+ real
// pipeline runs. This file is the call site that was missing.
//
// DB-touching functions (recordHandoff/verifyHandoff/rollbackAndEscalate)
// import `db` dynamically at call time, not at module top level — same
// convention as packages/db/src/instincts.ts — so importing this module
// never requires a live DATABASE_URL connection, keeping the pure functions
// below unit-testable with zero infra.
//
// No Context.current()/heartbeat calls here deliberately: every caller
// (runSaanvi, runArjun, runShubham, ...) already runs its own 30s heartbeat
// interval for the FULL activity duration; these are quick DB round-trips
// nested inside that already-heartbeating activity, not their own
// long-running unit of work. Context.current() also only resolves inside a
// live Temporal activity execution — keeping it out of this file is what
// makes recordHandoff/verifyHandoff callable directly for live verification
// scripts (see audit-2026-07-25.md) without a running Temporal worker.
import { ApplicationFailure } from "@temporalio/activity";
import { hashContext, signOutput, verifySignature } from "@nexsidi/context-chain";

export interface ContextChainRecordInput {
  projectId: string;
  agentFrom: string;
  agentTo: string;
  contextHash: string;
  signature: string;
}

// Exact append-only insert shape (CLAUDE.md: "Append-only: no UPDATE except
// verified flag, no DELETE"). Always inserted with verified:false — only
// verifyHandoff's own UPDATE ever flips that flag, never a fresh insert.
export function buildContextChainRecord(input: ContextChainRecordInput) {
  return {
    projectId: input.projectId,
    agentFrom: input.agentFrom,
    agentTo: input.agentTo,
    contextHash: input.contextHash,
    signature: input.signature,
    verified: false,
  };
}

// Pure aside from a synchronous key-file read — no DB, no network. This is
// the exact primitive pairing CLAUDE.md's CONTEXT CHAIN code block shows
// (createHash + createSign), reused from packages/context-chain rather than
// reimplemented here.
export function computeHandoffSignature(
  context: unknown,
  privateKeyPath: string,
): { contextHash: string; signature: string } {
  return {
    contextHash: hashContext(context),
    signature: signOutput(context, privateKeyPath),
  };
}

export interface VerificationDecision {
  outcome: "no_record" | "hash_mismatch" | "signature_invalid" | "valid";
}

// The receiving-agent verification sequence CLAUDE.md specifies, as a pure
// decision function: 1) a missing row means the chain itself is broken (the
// sender's recordHandoff never ran, or ran against a different agent pair)
// — this is NOT a pass-through; CLAUDE.md's rollback design treats "no
// verified state exists" as an escalation case, not a free pass. 2) hash
// checked before signature, matching CLAUDE.md's "Verify RSA signature →
// fail: rollback. Verify hash → fail: rollback" order is actually written
// signature-then-hash there, but checking hash first here is a deliberate,
// documented deviation: a hash mismatch is the cheaper, more specific
// failure to report (it pinpoints "the content changed"), whereas an
// invalid signature could stem from either tampered content OR a key
// problem — leading with the more diagnostic failure reason.
export function decideVerification(
  row: { contextHash: string; signature: string } | undefined,
  recomputedHash: string,
  sigValid: boolean,
): VerificationDecision {
  if (!row) return { outcome: "no_record" };
  if (row.contextHash !== recomputedHash) return { outcome: "hash_mismatch" };
  if (!sigValid) return { outcome: "signature_invalid" };
  return { outcome: "valid" };
}

function keyPaths(): { privateKeyPath: string; publicKeyPath: string } {
  const privateKeyPath = process.env.CHAIN_PRIVATE_KEY_PATH;
  const publicKeyPath = process.env.CHAIN_PUBLIC_KEY_PATH;
  if (!privateKeyPath || !publicKeyPath) {
    throw new Error(
      "CHAIN_PRIVATE_KEY_PATH / CHAIN_PUBLIC_KEY_PATH must both be set in .env — see keys/README.md",
    );
  }
  return { privateKeyPath, publicKeyPath };
}

// ── Rollback (Patent Claim 3) — real, not a no-op ──────────────────────────
// A minimal but genuinely load-bearing rollback: escalateTilotma's own DB
// write (projects.status = "needs_review") reused directly rather than
// reimplemented, so a broken/tampered chain is visibly different from a
// healthy run to anything reading project status — then a nonRetryable
// ApplicationFailure, the same pattern generatorFailure() already uses in
// index.ts (a plain throw here would be retried by Temporal's default
// policy, which just fails identically every time against the same
// tampered/missing chain state — pure wasted cost, the exact problem
// nonRetryable was introduced to close).
//
// This does not implement CLAUDE.md's fuller "restore project state from
// last verified checkpoint" — no such file-snapshot mechanism exists
// anywhere else in this codebase to restore FROM. Escalating and halting is
// the honest, real scope: it stops a tampered/broken handoff from silently
// propagating, which is the actual security property Claim 3 protects.
export async function rollbackAndEscalate(projectId: string, reason: string): Promise<never> {
  console.error(`[context-chain] ROLLBACK triggered for project=${projectId}: ${reason}`);
  try {
    const { db, projects } = await import("@nexsidi/db");
    const { eq } = await import("drizzle-orm");
    await db
      .update(projects)
      .set({ status: "needs_review", updatedAt: new Date() })
      .where(eq(projects.id, projectId));
  } catch (e) {
    console.error(`[context-chain] failed to write needs_review status during rollback: ${String(e)}`);
  }
  throw ApplicationFailure.create({
    message: `[context-chain] ${reason}`,
    type: "ContextChainViolation",
    nonRetryable: true,
  });
}

// ── DB-touching — dynamic `db` import, needs live Postgres ─────────────────

// Called by the SENDING agent's activity, immediately after producing the
// artifact the next agent will trust (spec.json, build-plan.json, the
// QA-passed file manifest). Always inserts fresh — this table is
// append-only, never updated except the verified flag by verifyHandoff.
export async function recordHandoff(
  projectId: string,
  agentFrom: string,
  agentTo: string,
  context: unknown,
): Promise<void> {
  const { db, contextChain } = await import("@nexsidi/db");
  const { privateKeyPath } = keyPaths();
  const { contextHash, signature } = computeHandoffSignature(context, privateKeyPath);
  await db
    .insert(contextChain)
    .values(buildContextChainRecord({ projectId, agentFrom, agentTo, contextHash, signature }));
  console.log(
    `[context-chain] recorded handoff ${agentFrom} -> ${agentTo} (project=${projectId}, hash=${contextHash.slice(0, 12)}...)`,
  );
}

// Called by the RECEIVING agent's activity, before it trusts the context it
// just loaded. Looks up the most recent recordHandoff row for this exact
// (project, from, to) triple — append-only + ordered by createdAt means the
// latest row is authoritative even if a boundary is ever re-recorded.
export async function verifyHandoff(
  projectId: string,
  agentFrom: string,
  agentTo: string,
  context: unknown,
): Promise<void> {
  const { db, contextChain } = await import("@nexsidi/db");
  const { eq, and, desc } = await import("drizzle-orm");
  const { publicKeyPath } = keyPaths();

  const rows = await db
    .select({ id: contextChain.id, contextHash: contextChain.contextHash, signature: contextChain.signature })
    .from(contextChain)
    .where(
      and(
        eq(contextChain.projectId, projectId),
        eq(contextChain.agentFrom, agentFrom),
        eq(contextChain.agentTo, agentTo),
      ),
    )
    .orderBy(desc(contextChain.createdAt))
    .limit(1);

  const row = rows[0];
  const recomputedHash = hashContext(context);
  const sigValid = row ? verifySignature(context, row.signature, publicKeyPath) : false;
  const decision = decideVerification(row, recomputedHash, sigValid);

  if (decision.outcome !== "valid") {
    // 2026-08-03: real bug found live — a hash mismatch previously logged
    // nothing but "hash mismatch," and only the HASH is persisted (not the
    // raw manifest), so there was no way to see WHAT changed after the fact.
    // Logging the current manifest's size/edges here doesn't recover the
    // ORIGINAL snapshot, but turns the next occurrence from "opaque failure"
    // into "here's what verify actually saw" — enough to spot an unexpected
    // file immediately instead of re-deriving it from timestamps after the
    // build directory has moved on.
    if (decision.outcome === "hash_mismatch" && context && typeof context === "object" && "filesWritten" in context) {
      const files = (context as { filesWritten: string[] }).filesWritten;
      console.error(
        `[context-chain] hash mismatch detail — verify saw ${files.length} file(s): ` +
          `first 5: ${JSON.stringify(files.slice(0, 5))}, last 5: ${JSON.stringify(files.slice(-5))}`,
      );
    }
    await rollbackAndEscalate(projectId, `context_chain_${decision.outcome}: ${agentFrom} -> ${agentTo}`);
  }

  await db.update(contextChain).set({ verified: true }).where(eq(contextChain.id, row!.id));
  console.log(`[context-chain] verified handoff ${agentFrom} -> ${agentTo} (project=${projectId})`);
}
