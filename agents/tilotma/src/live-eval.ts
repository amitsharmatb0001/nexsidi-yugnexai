// Tilotma — System B: subjective live-quality evaluator (P2, full agentic
// upgrade, 2026-07-24).
//
// System A (Navya/Karan/Deepika + Tier 3's binary READY/NEEDS_WORK) checks
// objective correctness — does it work, are there bugs. It cannot catch
// "the app works perfectly and looks like every other AI-generated site
// with a purple gradient over a white card" — CLAUDE.md's own System B
// exists specifically for that: a weighted 1-10 rubric over design quality,
// originality, craft, and functionality, run against the LIVE deployed app.
//
// Before this file: `runLiveTest` (pipeline/activities/index.ts) was a
// hardcoded `return 8.0` stub with ZERO callers anywhere in the codebase —
// System B did not exist. This is that build, wired into Stage 6's live
// retest (the same place Tier 3 legitimately runs, against a real URL).
//
// Single agent pass, not Tier 3's two-stage pattern: Tier 3's Stage
// 1-Collector/Stage 2-Checker split exists because objective findings need
// independent adversarial verification (D26). A holistic aesthetic
// judgment doesn't have a "was this claim true" question to adversarially
// re-check — one skeptical, evidence-gated pass (screenshots cited per
// score) is the right shape here, matching the rubric's own framing as a
// single evaluator's judgment, not a debate.
import { runAgentEscalated } from "@nexsidi/agent-runtime";
import { AGENT_MODELS } from "@nexsidi/llm-client";
import type { InstinctDomain } from "@nexsidi/db";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertValidIdentifier } from "../../../pipeline/orchestrator/checkpoint.ts";
import { countAppPages, computeTier3MaxIterations } from "./tier3-review.ts";
import { runWithQuotaWatchAndResume } from "../../../pipeline/activities/quota-retry.ts";
import { summarizeFindingToInstinctRule } from "../../../pipeline/orchestrator/stages/stage5-qa-fix-loop.ts";

export interface LiveEvalScores {
  designQuality: number;
  originality: number;
  craft: number;
  functionality: number;
}

export interface LiveEvalResult {
  pass: boolean;
  score: number;
  scores: LiveEvalScores | null;
  summary: string;
}

const SCREENSHOT_ROOT = "live-eval-screenshots";

// CLAUDE.md System B (authoritative) — weights and criteria text are
// verbatim, not paraphrased, per this codebase's established convention
// for QA rubrics (see nexsidi-adversarial-qa skill / karan's QA_SYSTEM_PROMPT
// citing CLAUDE.md line numbers). Changing these weights is a spec change,
// not a code change.
export const LIVE_EVAL_WEIGHTS: LiveEvalScores = {
  designQuality: 0.35,
  originality: 0.35,
  craft: 0.15,
  functionality: 0.15,
};

export const LIVE_PASS_THRESHOLD = 7.0;

export function calculateLiveScore(scores: LiveEvalScores): number {
  return (
    scores.designQuality * LIVE_EVAL_WEIGHTS.designQuality +
    scores.originality * LIVE_EVAL_WEIGHTS.originality +
    scores.craft * LIVE_EVAL_WEIGHTS.craft +
    scores.functionality * LIVE_EVAL_WEIGHTS.functionality
  );
}

// Parses the "DESIGN_QUALITY: <n>\nORIGINALITY: <n>\nCRAFT: <n>\n
// FUNCTIONALITY: <n>" block the system prompt instructs task_complete's
// summary to end with — same structured-block-at-the-end pattern as Tier
// 3's parseFindings (FINDINGS:/VERDICT:). Returns null (not a thrown
// error, not an invented score) when the block is missing or a score is
// out of the valid 1-10 range — an unparseable evaluation is evidence
// something went wrong, never silently treated as a passing score.
export function parseLiveEvalScores(summary: string): LiveEvalScores | null {
  const pattern = (label: string) => new RegExp(`${label}:\\s*(\\d+(?:\\.\\d+)?)`, "i");
  const extract = (label: string): number | null => {
    const match = summary.match(pattern(label));
    if (!match) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < 1 || value > 10) return null;
    return value;
  };

  const designQuality = extract("DESIGN_QUALITY");
  const originality = extract("ORIGINALITY");
  const craft = extract("CRAFT");
  const functionality = extract("FUNCTIONALITY");

  if (designQuality === null || originality === null || craft === null || functionality === null) {
    return null;
  }
  return { designQuality, originality, craft, functionality };
}

// 2026-08-08: real gap found live, explicit user request (project
// bae438767bed) — this whole qualitative review path had ZERO connection
// to instinct memory. recordInstinct (packages/db/src/instincts.ts) was
// only ever called from the STATIC QA fix-loop (stage5-qa-fix-loop.ts) —
// a low design/originality score here, the exact class of finding that
// caught Northgate's generic content, had nowhere to go and nothing ever
// learned from it. ONE injectable seam covering summarize+write together
// (not split into two DI points) — same granularity as recordInstincts in
// stage5-qa-fix-loop.ts, which also calls summarizeFindingToInstinctRule
// internally rather than exposing it separately. Splitting it into two
// hooks looked cleaner but left the summarize call (a REAL LLM request,
// no DI seam of its own) unstubbable — confirmed live: it hung an existing
// test for 5s until timeout. One seam means a test overriding it skips
// both the summarization AND the write in a single fast no-op.
export type RecordDesignInstinctFn = (findingText: string) => Promise<void>;

async function defaultRecordDesignInstinct(findingText: string): Promise<void> {
  try {
    const { recordInstinct } = await import("@nexsidi/db");
    const summarized = await summarizeFindingToInstinctRule(findingText, "vanya");
    // Attributed to "vanya" (not the evaluator that found it) — same
    // convention as stage5-qa-fix-loop.ts's recordInstincts, which credits
    // the agent whose OUTPUT needs correcting, not the QA agent that caught it.
    await recordInstinct("vanya", "design" as InstinctDomain, summarized.trigger, summarized.action);
  } catch (err) {
    console.log(`[live-eval] recordInstinct failed (non-fatal, memory is an enrichment): ${String(err)}`);
  }
}

export interface LiveEvalDeps {
  runAgent: typeof runAgentEscalated;
  recordDesignInstinct?: RecordDesignInstinctFn;
}

export async function runLiveEval(
  projectId: string,
  appUrl: string,
  frontendOutputDir: string,
  deps: LiveEvalDeps = { runAgent: runAgentEscalated },
): Promise<LiveEvalResult> {
  assertValidIdentifier(projectId, "projectId");

  const apiKey = process.env.NIM_API_KEY ?? "";
  const screenshotDir = join(SCREENSHOT_ROOT, projectId).replace(/\\/g, "/");
  mkdirSync(join(process.cwd(), screenshotDir), { recursive: true });

  // 2026-08-07: real bug found live (project bae438767bed, redeploy #5) —
  // this call used the shared MAX_ITERATIONS default (40) with no scaling,
  // the exact gap computeTier3MaxIterations was built to close for Tier 3's
  // two stages (see its header comment: "a fixed budget that doesn't scale
  // with real app size"). Confirmed live: hit iteration 40 still reading
  // component source (SignUpForm.tsx, SignInForm.tsx, vendor primitives)
  // with no task_complete — the whole live-eval pass was lost, and Stage 6
  // logged "No specific findings to route" for a judge that never actually
  // rendered a verdict, same failure shape Tier 3 already had. Same fix:
  // scale by real page count instead of a flat cap.
  const maxIterations = computeTier3MaxIterations(countAppPages(frontendOutputDir));

  // 2026-08-07: explicit user request, live (project bae438767bed) — this
  // call had zero quota retry; a single 429/pool-exhaustion aborted the
  // whole pass with no recovery, the exact failure observed live right
  // after the maxIterations fix above landed. See runWithQuotaWatchAndResume's
  // header comment in pipeline/activities/quota-retry.ts for the full
  // "watch every 5 min, resume once healthy" reasoning.
  const result = await runWithQuotaWatchAndResume(() =>
    deps.runAgent({
      agentName: "tilotma-live-eval",
      model: AGENT_MODELS.tilotma,
      apiKey,
      systemPrompt: LIVE_EVAL_SYSTEM_PROMPT,
      initialMessage: buildLiveEvalTask(projectId, appUrl, screenshotDir),
      sandboxDir: frontendOutputDir,
      projectId,
      enableBrowser: true,
      maxIterations,
      // 2026-08-07: same D26 reasoning as Tier 3's readOnly (see loop.ts) —
      // this is a JUDGE, not a fixer. Its own prompt only ever lists browser_*
      // tools as "available to you," but write_file/run_command are granted
      // to every agent unconditionally regardless of role unless explicitly
      // blocked. Closing this preventively here too, not just reactively
      // after observing the same misuse — a design/originality judge going
      // off-script to "fix" what it's scoring is the identical failure mode
      // that cost the reality-checker its entire budget twice this session.
      readOnly: true,
    }),
  );

  const scores = parseLiveEvalScores(result.summary);
  if (!scores) {
    // Default-FAIL (D25, same contract as System A): an unparseable
    // evaluation reads as "the review didn't produce a usable result," not
    // as a passing score by omission.
    return {
      pass: false,
      score: 0,
      scores: null,
      summary: `Live evaluation did not produce a parseable score block. Raw summary: ${result.summary.slice(0, 300)}`,
    };
  }

  const score = calculateLiveScore(scores);

  // 2026-08-08: the actual write — see RecordDesignInstinctFn's header
  // comment above for the full "this path had zero connection to memory"
  // gap. Scoped to designQuality/originality specifically: those are the
  // two dimensions CLAUDE.md's own rubric weights highest (0.35 each)
  // BECAUSE they're where generic AI output shows up (see
  // LIVE_EVAL_SYSTEM_PROMPT's own framing) — craft/functionality failures
  // are usually fundamentals bugs, a different class already covered by
  // System A. Non-fatal by construction: defaultRecordDesignInstinct
  // swallows its own errors, so a memory-write failure never affects the
  // score/verdict returned to the caller.
  if (scores.designQuality < LIVE_PASS_THRESHOLD || scores.originality < LIVE_PASS_THRESHOLD) {
    await (deps.recordDesignInstinct ?? defaultRecordDesignInstinct)(result.summary);
  }

  return { pass: score >= LIVE_PASS_THRESHOLD, score, scores, summary: result.summary };
}

export const LIVE_EVAL_SYSTEM_PROMPT = `\
You are Tilotma's subjective live-quality evaluator (System B). You judge the
DEPLOYED, RUNNING app on design quality, originality, craft, and functionality
— NOT correctness (a separate objective review already checks for bugs). Your
job is to catch apps that work perfectly and score well on objective QA, but
look like generic AI-generated slop: purple gradients over white cards,
unmodified template layouts, library defaults with no customization.

Score each dimension 1-10 using EXACTLY these criteria (verbatim from the
product spec — apply them as written, not your own general aesthetic sense):

DESIGN_QUALITY (weight 0.35): Does the design feel like a coherent whole
rather than a collection of parts? Strong work means colors, typography,
layout, imagery, and other details combine to create a distinct mood and
identity.

ORIGINALITY (weight 0.35): Is there evidence of custom decisions, or is this
template layouts, library defaults, and AI-generated patterns? Unmodified
stock components — or telltale signs of AI generation like purple gradients
over white cards — fail here.

CRAFT (weight 0.15): Technical execution — typography hierarchy, spacing
consistency, color harmony, contrast ratios. A competence check, not a
creativity check. Most reasonable implementations do fine here by default;
failing means broken fundamentals.

FUNCTIONALITY (weight 0.15): Usability independent of aesthetics. Can users
understand what the interface does, find primary actions, and complete tasks
without guessing?

Tools available to you:
- browser_navigate {url}: open a page.
- browser_screenshot {outputPath}: capture the CURRENT page. Take one on
  every page you judge — a score without a screenshot to back it is not
  evidence, it's a guess. The actual image is attached to your NEXT turn —
  LOOK AT IT. DESIGN_QUALITY and ORIGINALITY in particular cannot be judged
  from browser_get_text's extracted DOM string alone — color, layout,
  imagery, and visual coherence only exist in the pixels. A page can pass
  every text-based check while looking like generic AI-slop (or, the
  opposite failure mode: while being visually broken in a way the DOM text
  never reveals) — judge what's actually in the screenshot.
- browser_get_text: the visible text of the current page.
- browser_computed_style {selector}: computed CSS + bounding box — use this
  to back a CRAFT score with concrete spacing/contrast numbers, not eyeballing.
- browser_click {selector} / browser_current_url: exercise primary actions to
  judge FUNCTIONALITY concretely (can you find and complete the main task).

Your workflow:
1. browser_navigate to the app. browser_screenshot the landing page.
2. browser_get_text and browser_computed_style key sections (hero, nav,
   primary content) to ground DESIGN_QUALITY and CRAFT in specifics, not
   impressions.
3. Look specifically for AI-slop signals for ORIGINALITY: purple/blue
   gradient heroes, generic stock-photo imagery, unmodified default
   component library styling, centered-everything layouts, no distinct
   color/type identity. Their PRESENCE should pull the score down; their
   ABSENCE plus evidence of deliberate choices should pull it up.
4. Click 1-2 primary actions to judge FUNCTIONALITY — can you tell what to
   do and does it work as expected.
5. Screenshot at least 2 pages/states before scoring.
6. Call task_complete. End "summary" with EXACTLY this structure (numbers only,
   1-10, decimals allowed):

DESIGN_QUALITY: <score>
ORIGINALITY: <score>
CRAFT: <score>
FUNCTIONALITY: <score>
REASONING: <one paragraph per dimension citing the specific screenshot/tool
evidence behind each score — a score with no cited evidence is not credible>

BE EFFICIENT — you have a limited tool-call budget (~40 calls). Judge the
landing page and 1-2 key screens/flows, then STOP and call task_complete.
Reaching the call budget without calling task_complete means your evaluation
is LOST, so wrap up in time.
`;

export function buildLiveEvalTask(projectId: string, appUrl: string, screenshotDir: string): string {
  return `PROJECT: ${projectId}
FRONTEND URL: ${appUrl}
Save browser_screenshot outputPath to RELATIVE paths under: ${screenshotDir}/ (e.g. "${screenshotDir}/landing.png") — never absolute paths.

Navigate to the FRONTEND url and judge it per your system prompt's four
criteria. This app has ALREADY passed objective correctness review — your job
is purely the subjective design/originality/craft/functionality judgment.
Be skeptical of anything that looks like a template or an unmodified AI
default; reward genuine, evidenced design decisions.`;
}
