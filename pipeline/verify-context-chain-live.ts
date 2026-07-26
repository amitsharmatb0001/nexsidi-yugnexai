// One-shot: prove the context-chain wiring live against the real Postgres
// instance, the same way seedInstincts() was verified (audit-2026-07-25.md,
// Phase 3) — a passing unit test on a pure function is not sufficient
// proof on its own. Run directly (no Temporal worker needed): the DB-
// touching functions are callable outside an activity execution context
// now that Context.current()/heartbeat was removed from them.
import { db, contextChain, projects } from "@nexsidi/db";
import { eq, and } from "drizzle-orm";
import { recordHandoff, verifyHandoff } from "./activities/context-chain-activities.ts";

const projectId = "ctxchainlv";
const agentFrom = "saanvi";
const agentTo = "arjun";

async function rowCount(): Promise<number> {
  const r = await db.execute("select count(*)::int as n from context_chain");
  const rows = ((r as unknown as { rows?: Array<{ n: number }> }).rows ?? r) as Array<{ n: number }>;
  return rows[0]!.n;
}

async function main() {
  console.log(`BEFORE — context_chain row count: ${await rowCount()}`);

  // Ensure a real projects row exists so the rollback path's status write
  // is observable too, not just the ApplicationFailure throw.
  await db.insert(projects).values({
    id: projectId,
    userId: "00000000-0000-0000-0000-000000000000",
    name: "context-chain live verification",
    status: "generating",
  }).onConflictDoUpdate({ target: projects.id, set: { status: "generating" } });

  // ── 1. Success path: record then verify the SAME context ────────────────
  const context = { features: ["auth", "dashboard"], projectId };
  await recordHandoff(projectId, agentFrom, agentTo, context);

  const afterRecord = await db
    .select()
    .from(contextChain)
    .where(and(eq(contextChain.projectId, projectId), eq(contextChain.agentFrom, agentFrom), eq(contextChain.agentTo, agentTo)));
  console.log(`AFTER recordHandoff — row: ${JSON.stringify({ ...afterRecord[0], contextHash: afterRecord[0]!.contextHash.slice(0, 16) + "..." })}`);
  if (afterRecord[0]!.verified !== false) throw new Error("expected verified=false immediately after record");

  await verifyHandoff(projectId, agentFrom, agentTo, context);

  const afterVerify = await db
    .select()
    .from(contextChain)
    .where(and(eq(contextChain.projectId, projectId), eq(contextChain.agentFrom, agentFrom), eq(contextChain.agentTo, agentTo)));
  console.log(`AFTER verifyHandoff (matching context) — verified=${afterVerify[0]!.verified}`);
  if (afterVerify[0]!.verified !== true) throw new Error("expected verified=true after a matching verifyHandoff");

  console.log(`AFTER success path — context_chain row count: ${await rowCount()}`);

  // ── 2. Rollback path: verify a DIFFERENT context than was recorded ──────
  const tamperedAgentTo = "arjun-tampered";
  await recordHandoff(projectId, agentFrom, tamperedAgentTo, { features: ["auth"] });
  let rollbackFired = false;
  let rollbackMessage = "";
  try {
    await verifyHandoff(projectId, agentFrom, tamperedAgentTo, { features: ["auth", "PRIVILEGE_ESCALATION"] });
  } catch (err) {
    rollbackFired = true;
    rollbackMessage = String((err as Error).message ?? err);
  }
  console.log(`Rollback fired on tampered context: ${rollbackFired} (${rollbackMessage})`);
  if (!rollbackFired) throw new Error("expected verifyHandoff to throw on a hash mismatch");

  const tamperedRow = await db
    .select()
    .from(contextChain)
    .where(and(eq(contextChain.projectId, projectId), eq(contextChain.agentFrom, agentFrom), eq(contextChain.agentTo, tamperedAgentTo)));
  console.log(`Tampered row stayed verified=${tamperedRow[0]!.verified} (must be false — never marked verified on mismatch)`);
  if (tamperedRow[0]!.verified !== false) throw new Error("tampered row must never be marked verified");

  const projectRow = await db.select().from(projects).where(eq(projects.id, projectId));
  console.log(`Project status after rollback escalation: ${projectRow[0]!.status} (must be needs_review)`);
  if (projectRow[0]!.status !== "needs_review") throw new Error("rollback must escalate project status to needs_review");

  // ── 3. Rollback path: verify with no matching record at all ─────────────
  let noRecordRollbackFired = false;
  try {
    await verifyHandoff(projectId, "nobody", "nowhere", { anything: true });
  } catch {
    noRecordRollbackFired = true;
  }
  console.log(`Rollback fired on missing chain record: ${noRecordRollbackFired}`);
  if (!noRecordRollbackFired) throw new Error("expected verifyHandoff to throw when no record exists");

  console.log(`FINAL — context_chain row count: ${await rowCount()}`);
  console.log("ALL LIVE CHECKS PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("LIVE VERIFICATION FAILED:", err);
  process.exit(1);
});
