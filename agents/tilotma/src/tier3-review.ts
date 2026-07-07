// Tilotma — Stage 5 Tier 3: evidence-based final review before Stage 6 deploy.
//
// Implements the Aarav two-stage evidence pattern (nexsidi-agency-engineers /
// design doc Stage 5 Tier 3): Stage 1 Evidence Collector takes screenshots and
// defaults to assuming issues exist ("screenshots don't lie" — a first pass
// that reports zero issues has not looked hard enough, not a clean app).
// Stage 2 Reality Checker independently re-verifies Stage 1's claims against
// its OWN fresh screenshot evidence of the SAME running app, skeptical by
// default, defaulting to "NEEDS WORK" unless the evidence overwhelmingly
// supports "READY".
//
// ── Design choice: two separate agent runs, not one run with two turns ──
// D26 (already established for Navya/Karan/Deepika) is "fresh-context
// evaluator — no write tools, no generation history": a self-review inside
// the SAME conversation just re-reads its own reasoning trace and tends to
// rubber-stamp it. A genuinely separate agent run means Stage 2 sees
// ONLY Stage 1's raw findings text (not the tool-call trail that produced
// them) and takes its OWN screenshots of the same running app before
// judging — that is what makes it a "reality check" rather than a
// self-review. A single call with two prompted turns was considered and
// rejected specifically because it would undermine the independence the
// pattern exists to provide.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runAgentEscalated } from "@nexsidi/agent-runtime";
import { AGENT_MODELS } from "@nexsidi/llm-client";
import { assertValidIdentifier } from "../../../pipeline/orchestrator/checkpoint.ts";

// Both passes use runAgentEscalated (Task 15), not plain runAgent: NIM/
// open-source (deepseek-v4-pro) runs first and is used whenever it succeeds
// — routine visual review is well within its range and Claude Sonnet 5 stays
// unused (and unbilled) for the common case. Only when the open-source pass
// fails to produce a verified result (task_complete never called with
// verification_passed, malformed tool loop, model gives up) does this
// escalate to Sonnet 5 for a single retry of the SAME task. This is the
// intended shape of the escalation tier per explicit user direction: hard
// judgment calls only, never a routine-cost default — see
// packages/agent-runtime/src/claude-loop.ts's runAgentEscalated for the
// exact one-time-retry contract.

export interface Tier3ReviewResult {
  pass: boolean;
  findings: string[];
}

// packages/agent-runtime's execScreenshot resolves outputPath relative to
// process.cwd() (not the agent's sandboxDir) — see
// packages/agent-runtime/src/tools/screenshot.ts. All Tier 3 screenshots are
// kept under one cwd-relative folder so this works regardless of where the
// orchestrator process is started from.
const SCREENSHOT_ROOT = "tier3-review-screenshots";

export async function runTier3Review(
  projectId: string,
  frontendOutputDir: string,
): Promise<Tier3ReviewResult> {
  assertValidIdentifier(projectId, "projectId");

  const apiKey = process.env.NIM_API_KEY ?? "";
  const appUrl = process.env.TIER3_REVIEW_URL ?? "http://localhost:3000";
  const screenshotDir = join(SCREENSHOT_ROOT, projectId).replace(/\\/g, "/");
  mkdirSync(join(process.cwd(), screenshotDir), { recursive: true });

  // ── Stage 1: Evidence Collector ─────────────────────────────────────────
  const stage1 = await runAgentEscalated({
    agentName: "tilotma-evidence-collector",
    model: AGENT_MODELS.tilotma,
    apiKey,
    systemPrompt: EVIDENCE_COLLECTOR_PROMPT,
    initialMessage: buildEvidenceCollectorTask(projectId, appUrl, screenshotDir),
    sandboxDir: frontendOutputDir,
    enableScreenshot: true,
    enableHttpTools: true,
  });

  const stage1Findings = parseFindings(stage1.summary);

  // ── Stage 2: Reality Checker — a genuinely separate agent run ───────────
  const stage2 = await runAgentEscalated({
    agentName: "tilotma-reality-checker",
    model: AGENT_MODELS.tilotma,
    apiKey,
    systemPrompt: REALITY_CHECKER_PROMPT,
    initialMessage: buildRealityCheckerTask(projectId, appUrl, screenshotDir, stage1Findings),
    sandboxDir: frontendOutputDir,
    enableScreenshot: true,
    enableHttpTools: true,
  });

  const stage2Findings = parseFindings(stage2.summary);

  return {
    // task_complete's verification_passed is the pass/fail signal, per spec.
    // Stage 2 (the skeptical, default-to-NEEDS-WORK pass) is authoritative —
    // Stage 1 always reports verification_passed=true for "review completed",
    // never for "app is ready" (see EVIDENCE_COLLECTOR_PROMPT).
    pass: stage2.success,
    findings: stage2Findings.length > 0 ? stage2Findings : stage1Findings,
  };
}

const EVIDENCE_COLLECTOR_PROMPT = `\
You are Tilotma's Stage 1 Evidence Collector — the first half of a two-stage
evidence-based visual review of a generated web app, immediately before it is
delivered to a real user.

"Screenshots don't lie." Your job is to LOOK, not to assume the app is fine.
Default-assume issues exist — a first pass that reports zero issues has not
looked hard enough. You are not here to praise the work.

Your workflow:
1. Use the screenshot tool to capture the app's key pages/states (landing,
   sign-in, main authenticated view, any empty/loading/error states you can
   reach). Save each screenshot under the folder given in the task message.
2. Optionally use http_request to confirm pages/APIs actually respond before
   trusting what you see.
3. Compare what you see against a professional, shipped-product bar: layout,
   spacing, typography, broken or misaligned elements, placeholder/lorem-ipsum
   text left in, obviously non-functional buttons, empty states with no
   messaging, anything that reads as AI-generated template slop (e.g. purple
   gradients over plain white cards, unmodified library defaults).
4. List AT LEAST 3-5 concrete issues, each backed by a specific screenshot and
   a specific description of what is wrong in it. If you genuinely cannot find
   that many, say explicitly what you checked and why fewer than 3 real issues
   remain — do not pad the list with trivial nitpicks just to hit a count, but
   do not stop looking early either.
5. Call task_complete. In "summary", end with EXACTLY this structure so it can
   be parsed programmatically:

FINDINGS:
- <issue 1, naming which screenshot shows it>
- <issue 2, naming which screenshot shows it>
...
VERDICT: NEEDS_WORK

(As the Evidence Collector you ALWAYS end with VERDICT: NEEDS_WORK — Stage 2,
run separately with fresh eyes, is the only one authorized to conclude READY.
Set verification_passed to true once you have genuinely completed the
evidence-collection pass, whether or not real issues were found —
verification_passed here means "the review was actually attempted with real
screenshots," not "the app is ready to ship.")
`;

function buildEvidenceCollectorTask(projectId: string, appUrl: string, screenshotDir: string): string {
  return `PROJECT: ${projectId}
APP URL: ${appUrl}
Save screenshots to RELATIVE paths under: ${screenshotDir}/ (e.g. "${screenshotDir}/dashboard.png")
Use ONLY relative paths for the screenshot tool's outputPath — never absolute paths.

Take screenshots of the running app at ${appUrl} and produce your FINDINGS list
per your system prompt. This is the first, evidence-gathering pass — be
thorough and skeptical. If the app is unreachable, that IS a finding (report
it, do not silently give up).`;
}

const REALITY_CHECKER_PROMPT = `\
You are Tilotma's Stage 2 Reality Checker — the second half of a two-stage
evidence-based visual review. You did NOT write Stage 1's findings and you
have no memory of how it reasoned — you only see its raw claims below. Your
job is to independently verify each claim against your OWN fresh screenshot
evidence of the SAME running app before agreeing with any of it.

Be skeptical by default. Default to "NEEDS WORK" unless the evidence
overwhelmingly supports "READY" — a review that rubber-stamps Stage 1 without
independently re-checking is not doing its job. Specifically:
1. Take your own screenshots of the same app at the same URL — do not simply
   trust Stage 1's description of what a screenshot shows.
2. For each Stage 1 claim: confirm it against your own screenshot, downgrade
   it if it is a nitpick that does not actually block shipping, or note if
   Stage 1 missed something real.
3. Conclude with a final, honest verdict.
4. Call task_complete. In "summary", end with EXACTLY this structure:

FINDINGS:
- <issue 1, confirmed/adjusted from Stage 1 or newly found, with evidence>
- <issue 2, ...>
...
VERDICT: READY
(or)
VERDICT: NEEDS_WORK

Set verification_passed to true ONLY if your verdict is READY. Set it to
false if your verdict is NEEDS_WORK. Do not set verification_passed to true
just because the review process itself completed — it must reflect whether
the app is actually ready to ship.
`;

function buildRealityCheckerTask(
  projectId: string,
  appUrl: string,
  screenshotDir: string,
  stage1Findings: string[],
): string {
  const findingsBlock =
    stage1Findings.length > 0
      ? stage1Findings.map((f) => `- ${f}`).join("\n")
      : "(Stage 1 reported no parseable findings — treat that itself with suspicion and check thoroughly.)";

  return `PROJECT: ${projectId}
APP URL: ${appUrl}
Save your own screenshots to RELATIVE paths under: ${screenshotDir}/ (e.g. "${screenshotDir}/recheck-dashboard.png")
Use ONLY relative paths for the screenshot tool's outputPath — never absolute paths.

STAGE 1'S RAW FINDINGS (independently verify each against your own fresh
screenshots — do not assume these are accurate just because they were written
down):
${findingsBlock}

Take your own screenshots of ${appUrl}, verify or refute each claim above,
look for anything Stage 1 missed, then give your final READY/NEEDS_WORK
verdict per your system prompt.`;
}

// Parses the "FINDINGS:\n- ...\nVERDICT: ..." block an agent's task_complete
// summary is instructed to end with. Falls back to treating the whole summary
// as a single finding if the structure isn't present — an unparseable summary
// is itself evidence something went wrong, not something to silently drop.
export function parseFindings(summary: string): string[] {
  // No \s* right after "FINDINGS:" — letting the capture group own all the
  // whitespace (instead of \s* greedily eating the separating newline) is
  // what makes a genuinely empty findings block (zero issues) correctly
  // match "\nVERDICT:" instead of falling through to "$" and swallowing the
  // VERDICT line itself as if it were unparsed content.
  const findingsMatch = summary.match(/FINDINGS:([\s\S]*?)(?:\n\s*VERDICT:|$)/i);
  if (!findingsMatch) {
    return summary.trim() ? [summary.trim()] : [];
  }
  const lines = (findingsMatch[1] ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"))
    .map((l) => l.replace(/^-\s*/, ""))
    .filter(Boolean);
  return lines.length > 0 ? lines : summary.trim() ? [summary.trim()] : [];
}
