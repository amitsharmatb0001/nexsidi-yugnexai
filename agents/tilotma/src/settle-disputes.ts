// Tilotma settles disputed findings (evidence-only plan, approved by Amit
// 3 Oct 2026). A builder that checked a finding and found it not true records
// a dispute (tools/dispute.ts). Tilotma — the only agent that sees the whole
// project — checks each one herself, in the code, on the running app and in
// the database, and records a verdict with her evidence (tools/settle.ts).
// The builder's account is a claim too: she decides from what she sees.
import { runAgentEscalated, readVerdicts, type Dispute } from "@nexsidi/agent-runtime";
import { runWithQuotaWatchAndResume } from "../../../pipeline/activities/quota-retry.ts";
import type { DisputeVerdict } from "../../../pipeline/orchestrator/disputes.ts";

// Same model the reality checker uses (measured on project a034f90ba50e:
// the NIM model did not finish browser-driven checks; this one did).
const SETTLER_MODEL = "gemini-3.8-flash" as const;

export const SETTLER_PROMPT = `\
You are Tilotma, settling disputed review findings. A builder checked each
finding below and says it is not true. Neither the finding nor the builder's
account is a fact until you check it yourself.

For each dispute:
1. Check it yourself: read the code it names (read_file), request the page or
   endpoint (http_request, browser tools when the app is running), query the
   database (db_query) — whatever decides it.
2. Call settle_dispute with its number, "true" if the finding holds or
   "not_true" if it does not, and the evidence you saw (quote the code, the
   response or the page).
3. If you cannot check one, do not settle it — it stays open.
You change nothing. When every dispute you could check is settled, call
task_complete.`;

export function buildSettleTask(disputes: Dispute[], urls: { appUrl?: string; backendUrl?: string }): string {
  const where = urls.appUrl
    ? `The app is running: frontend ${urls.appUrl}${urls.backendUrl ? `, backend ${urls.backendUrl}` : ""}.`
    : "The app is not running yet: check the code.";
  const list = disputes
    .map((d, i) => `${i + 1}. FINDING: ${d.finding}\n   THE BUILDER CHECKED: ${d.checked}\n   THE BUILDER SAW: ${d.observed}`)
    .join("\n\n");
  return `${where}\n\nDISPUTES — check each one yourself, then call settle_dispute:\n\n${list}`;
}

export interface SettleDeps {
  run: typeof runAgentEscalated;
}

export async function settleDisputes(
  projectId: string,
  disputes: Dispute[],
  opts: { reviewRoot: string; appUrl?: string; backendUrl?: string },
  deps: SettleDeps = { run: runAgentEscalated },
): Promise<DisputeVerdict[]> {
  if (disputes.length === 0) return [];
  const since = new Date().toISOString();
  const live = Boolean(opts.appUrl);
  await runWithQuotaWatchAndResume(() =>
    deps.run({
      agentName: "tilotma-dispute-settler",
      model: SETTLER_MODEL,
      apiKey: process.env.NIM_API_KEY ?? "",
      systemPrompt: SETTLER_PROMPT,
      initialMessage: buildSettleTask(disputes, opts),
      sandboxDir: opts.reviewRoot,
      projectId,
      readOnly: true,
      enableHttpTools: live,
      enableBrowser: live,
      enableDbQuery: live,
      enableDisputeSettling: true,
      allowFailedVerification: true,
      extendStepsWhileProgressing: true,
      freshStart: true,
    }),
  );
  // The last verdict per dispute number counts; numbers outside the list are ignored.
  const byNumber = new Map<number, { verdict: "true" | "not_true"; evidence: string }>();
  for (const v of readVerdicts(projectId, since)) byNumber.set(v.number, { verdict: v.verdict, evidence: v.evidence });
  return [...byNumber.entries()]
    .filter(([n]) => n >= 1 && n <= disputes.length)
    .sort(([a], [b]) => a - b)
    .map(([n, v]) => ({ dispute: disputes[n - 1]!, verdict: v.verdict, evidence: v.evidence }));
}
