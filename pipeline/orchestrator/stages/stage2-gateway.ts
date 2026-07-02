// Stage 2 — Human approval gate on the locked spec.
// OTP/payment enforcement is not built yet (see resolveFlags() callers
// elsewhere in the plan) — for now this stage always requests a plain
// Proceed/Review decision. resolveFlags() is still invoked so the hook point
// exists for when OTP/payment gating lands; it currently has no branching
// effect on this stage's behavior.
import { resolveFlags } from "../flags.ts";
import { writeGatewayRequest, readGatewayDecision } from "../gateway.ts";
import type { GatewayDecision } from "../types.ts";

const STAGE_ID = "02-gateway";
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30 * 60_000; // 30 minutes — human approval gates can be slow, but must not hang forever

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeSpec(spec: unknown): string {
  if (spec && typeof spec === "object") {
    const s = spec as Record<string, unknown>;
    const name = typeof s.name === "string" ? s.name : "Untitled project";
    const description = typeof s.description === "string" ? s.description : "";
    const featureCount = Array.isArray(s.features) ? s.features.length : 0;
    return `${name} — ${description} (${featureCount} feature${featureCount === 1 ? "" : "s"})`;
  }
  return "Project spec ready for review.";
}

export async function runStage2(projectId: string, spec: unknown): Promise<GatewayDecision> {
  resolveFlags();

  writeGatewayRequest(projectId, STAGE_ID, summarizeSpec(spec));

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const decision = await readGatewayDecision(projectId, STAGE_ID);
    if (decision !== null) return decision;
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Stage 2 gateway timed out after ${POLL_TIMEOUT_MS}ms waiting for a human decision (project ${projectId})`
  );
}
