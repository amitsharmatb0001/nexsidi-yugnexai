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
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runAgentEscalated, MAX_ITERATIONS } from "@nexsidi/agent-runtime";
import { AGENT_MODELS } from "@nexsidi/llm-client";
import { assertValidIdentifier } from "../../../pipeline/orchestrator/checkpoint.ts";
import { runWithQuotaWatchAndResume } from "../../../pipeline/activities/quota-retry.ts";

// 2026-07-27 (live, complex1): real gap found live — the shared default
// MAX_ITERATIONS (40) let the reality-checker spend its entire budget
// reading real pages and taking screenshots, then run out before ever
// rendering a verdict (confirmed via the raw log: iteration 40 was
// mid-screenshot, task_complete never called). Same root-cause pattern as
// agent-runtime's qa-loop.ts computeQaMaxIterations — a fixed budget that
// doesn't scale with real app size — applied here to Tier-3's page-by-page
// review instead of QA's file-by-file review.
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "vendor"]);

export function countAppPages(frontendOutputDir: string): number {
  let count = 0;
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(full);
      else if (entry === "page.tsx" || entry === "page.ts") count++;
    }
  };
  walk(frontendOutputDir);
  return count;
}

// Budget: a few iterations per real page (navigate, screenshot, sometimes
// interact — complex1's 9 pages consumed all 40 iterations reading files
// plus 2 screenshots, well short of a verdict), plus a fixed baseline for
// setup/investigation/rendering the final verdict. Floored at the shared
// default so small/simple apps are unaffected.
export function computeTier3MaxIterations(pageCount: number): number {
  return Math.max(MAX_ITERATIONS, pageCount * 6 + 25);
}

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
  // 2026-08-17: real gap found live (fulfillio1) — this used to read
  // TIER3_REVIEW_URL/TIER3_REVIEW_BACKEND_URL from process.env, defaulting
  // to localhost:3000/3001. That's wrong for every project whose deployed
  // ports were dynamically allocated (findFreePort) — this pipeline hasn't
  // called runTier3Review from the live workflow at all since 2026-07-24
  // (see project-build.ts's own comment on the deleted legacy QA loop), so
  // the env-var default was never actually exercised against a real
  // deployment. Worse: process.env is shared across every Temporal activity
  // in this worker process — mutating it per-call to point at the right
  // project would race the moment two projects' Stage 6 activities run
  // concurrently. Real params, with the old env vars kept only as a
  // fallback for direct/manual script invocations, close both gaps at once.
  appUrl: string = process.env.TIER3_REVIEW_URL ?? "http://localhost:3000",
  backendUrl: string = process.env.TIER3_REVIEW_BACKEND_URL ?? "http://localhost:3001",
): Promise<Tier3ReviewResult> {
  assertValidIdentifier(projectId, "projectId");

  const apiKey = process.env.NIM_API_KEY ?? "";
  const screenshotDir = join(SCREENSHOT_ROOT, projectId).replace(/\\/g, "/");
  mkdirSync(join(process.cwd(), screenshotDir), { recursive: true });

  // 2026-07-27 (live, complex1): both stages walk the SAME frontend, so one
  // page count drives both budgets — a 9-page app needs more room for both
  // the evidence sweep and the reality-check re-sweep, not just one of them.
  const maxIterations = computeTier3MaxIterations(countAppPages(frontendOutputDir));

  // ── Stage 1: Evidence Collector ─────────────────────────────────────────
  // 2026-08-07: explicit user request, live (project bae438767bed) — this
  // call had ZERO quota retry before this: a single 429 aborted the whole
  // stage. runWithQuotaWatchAndResume closes that gap (see its header
  // comment in pipeline/activities/quota-retry.ts) — re-running this exact
  // call is always safe (no partial state to lose), so "picking up where it
  // left off" is just re-invoking it once models are confirmed healthy.
  const stage1 = await runWithQuotaWatchAndResume(() =>
    runAgentEscalated({
      agentName: "tilotma-evidence-collector",
      model: AGENT_MODELS.tilotma,
      apiKey,
      systemPrompt: EVIDENCE_COLLECTOR_PROMPT,
      initialMessage: buildEvidenceCollectorTask(projectId, appUrl, backendUrl, screenshotDir),
      sandboxDir: frontendOutputDir,
      projectId,
      enableBrowser: true,   // 2026-07-11: real interactive QA (navigate/click/fill/console-errors/computed-style) via the Node browser worker — replaces the single-shot screenshot tool
      enableHttpTools: true,
      enableDbQuery: true,   // read-only data-round-trip verification
      maxIterations,
      // 2026-08-06: see readOnly's definition in loop.ts — this is Stage 1 of
      // a two-stage EVIDENCE review, not a fix pass. Without this, write_file/
      // run_command are silently available (loop.ts grants them to every
      // agent unconditionally) and nothing in this prompt forbids using them.
      readOnly: true,
    }),
  );

  const stage1Findings = parseFindings(stage1.summary);

  // ── Stage 2: Reality Checker — a genuinely separate agent run ───────────
  // 2026-08-07: same runWithQuotaWatchAndResume wrapping as Stage 1 above —
  // this is the exact call that hit "all pool models exhausted" live on
  // project bae438767bed with no recovery path, forcing a manual re-run.
  const stage2 = await runWithQuotaWatchAndResume(() =>
    runAgentEscalated({
      agentName: "tilotma-reality-checker",
      model: AGENT_MODELS.tilotma,
      apiKey,
      systemPrompt: REALITY_CHECKER_PROMPT,
      initialMessage: buildRealityCheckerTask(projectId, appUrl, backendUrl, screenshotDir, stage1Findings),
      sandboxDir: frontendOutputDir,
      projectId,
      enableScreenshot: true,
      enableHttpTools: true,
      maxIterations,
      // 2026-08-06: real bug found live (project 88d7b375eaef) — this agent is
      // an EVALUATOR, not a generator: REALITY_CHECKER_PROMPT explicitly
      // instructs "Set it false if [verdict is NEEDS_WORK]" because a
      // confirmed real bug in the app under review is a legitimate, complete
      // finding, not unfinished work. Without this flag, the shared
      // completion gate (built for generators, where false always means "keep
      // going") rejected that honest false and forced the agent to resubmit
      // with verification_passed flipped to true and the IDENTICAL finding
      // text — no new evidence, no fix — coercing a false-positive pass that
      // let a confirmed, documented bug (corrupted NexUI fonts, 404ing from
      // the wrong path) deploy undetected. See completion-gate.ts.
      allowFailedVerification: true,
      // 2026-08-06: real bug found live (project bae438767bed) — with
      // write_file/run_command silently available (see loop.ts's readOnly),
      // this agent spent its ENTIRE 61-iteration budget on 4 rounds of
      // self-repair on a font bug it correctly found, instead of reporting it
      // and calling task_complete. It never produced a verdict — Stage 6's fix
      // loop then saw zero parseable findings ("No specific findings to route")
      // and silently exited, masking a real, confirmed, blocking bug as if
      // nothing had been found. This agent's ONLY deliverable is a FINDINGS
      // list + READY/NEEDS_WORK verdict; fixing is Aanya/Shubham/Pranav's job
      // in the routed fix-loop that runs AFTER this verdict, via their own
      // proper build+restart pipeline (see agents/generators/aanya/shubham).
      readOnly: true,
    }),
  );

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

// 2026-07-11: rewritten from a screenshot-only reviewer into a real
// interactive tester. It now DRIVES the app with browser_* tools (navigate,
// click, fill, read text, catch console/network errors, inspect computed
// layout) and db_query (read-only) — the capability that lets it actually
// verify buttons work, forms submit, redirects land, no 404s/JS errors, the
// header/footer render, spacing/typography are sane, and data round-trips to
// the database — instead of guessing from one static screenshot.
export const EVIDENCE_COLLECTOR_PROMPT = `\
You are Tilotma's Stage 1 Evidence Collector — the first half of a two-stage,
evidence-based review of a generated web app, immediately before delivery.

You DRIVE the app with real browser tools. Do NOT assume anything works — click
it, fill it, read it, and check the DB. Default-assume issues exist; a first
pass that reports zero issues has not looked hard enough.

Base every judgment on what browser_get_text/browser_element_exists/
browser_screenshot actually return — visible page state — never on what the
source code or file structure implies should be there. Something can compile
clean and still render broken. (Source: Codex's control-in-app-browser skill,
verified live 2026-07-26 — "Base interactions on visible page state from the
DOM and screenshots rather than source order.")

Tools available to you:
- browser_navigate {url}: open a page. It returns the HTTP status and the FINAL
  url — if the app redirects (e.g. to /sign-in) that is reported here.
- browser_console_errors: JS console errors + failed network requests (404s) on
  the current page. A production app should have ZERO. Check after every load.
- browser_get_text: the visible text of the current page (find placeholder/lorem
  text, error messages, empty states).
- browser_element_exists {selector}: assert required UI is present (e.g. 'header',
  'footer', "button:has-text('Add')").
- browser_computed_style {selector}: computed CSS + bounding box — verify
  spacing/typography/contrast concretely, not by eyeballing.
- browser_click {selector} / browser_fill {selector,value}: exercise buttons and
  forms. After a click, use browser_current_url to confirm it navigated correctly
  (no 404, redirect went where expected).
- browser_screenshot {outputPath}: capture the CURRENT page for visual judgment
  of layout/rendering. Save under the folder given in the task message. The actual
  image is attached to your NEXT turn — LOOK AT IT. Check for things text-only
  checks cannot catch: corrupted/garbled glyphs, misaligned or overlapping
  elements, broken images, illegible contrast, layout that doesn't match what
  browser_get_text implies. A page that reads correctly in browser_get_text can
  still be visually broken — judge the pixels, not just the DOM text.
- http_request: hit the BACKEND api url directly to confirm endpoints respond.
- db_query {query}: run a READ-ONLY SELECT against the app's database to confirm
  data (e.g. required tables/columns exist; after creating something, that a row
  appeared).

Your workflow:
1. browser_navigate to the FRONTEND url. Note any redirect. Immediately call
   browser_console_errors — report every 404 / JS error as a finding.
2. browser_get_text and browser_screenshot the landing/first page. Check for:
   - Placeholder text, broken layout, missing header/footer (browser_element_exists)
   - Slop: purple-gradient-over-white-card AI defaults, generic template feel
   - INTERNAL BRAND NAMES in footer/navbar: scan browser_get_text output for
     "NexSidi", "NexUI", "@yugnex" — these must NEVER appear in user-facing text.
     Report as a finding if found.
   - RAW ISO DATE STRINGS: scan browser_get_text output for dates in ISO format
     like "2026-07-13T00:00:00" or bare "2026-07-13" that should be formatted
     as "13 Jul 2026" or similar. Report as a finding if raw dates are visible.
   - HARDCODED STATUS BADGES: scan for any "Connected", "API Connected", or
     "Online" badge visible unconditionally — these should only appear after a
     real API check. Report as a finding if a status badge appears on first load
     without any API call having been made.
   - CORRUPTED/GARBLED TEXT IN THE SCREENSHOT IMAGE ITSELF: look at the actual
     attached image, not just browser_get_text's extracted DOM string — a
     font/encoding bug can render wrong or mangled glyphs even when the
     underlying text is correct. Report as a finding if the image shows garbled
     characters anywhere.
   Use browser_computed_style on key elements to check spacing/typography concretely.
3. Exercise the primary flow as far as you can: click primary buttons/links,
   fill visible forms, and after each action check browser_current_url +
   browser_console_errors to catch dead buttons, wrong redirects, and errors.
   (If the app gates behind sign-in and you cannot authenticate, say so — that
   itself limits what can be verified, and is a finding to note, not a pass.)
4. Verify the data layer: use db_query to confirm the expected tables/columns
   exist (query information_schema), and http_request the backend api url to
   confirm it responds (an auth-required endpoint returning 401 without a token
   is CORRECT, not a bug). Do NOT test api paths against the frontend url.
5. List AT LEAST 3-5 concrete issues, each backed by the specific tool result
   that shows it. If you genuinely cannot find that many after real testing, say
   what you checked and why — do not pad with nitpicks, do not stop early.
6. Call task_complete. End "summary" with EXACTLY this structure:

BE EFFICIENT — you have a limited tool-call budget (~40 calls). Drive the KEY
flows once (landing, sign-in/up, the main authenticated view if reachable) plus
the console-error and data-layer checks, then STOP and call task_complete with
your findings. Do NOT exhaustively re-fill the same form or repeat checks — a
few fills to confirm a form works is enough. Reaching the call budget without
calling task_complete means your findings are LOST, so wrap up in time.

FINDINGS:
- <issue 1, citing the tool output that proves it>
- <issue 2, ...>
...
VERDICT: NEEDS_WORK

(As the Evidence Collector you ALWAYS end with VERDICT: NEEDS_WORK — Stage 2,
run separately with fresh eyes, is the only one authorized to conclude READY.
Set verification_passed to true once you have genuinely driven the app and
gathered evidence — it means "the review actually happened," NOT "the app is
ready to ship.")
`;

// 2026-07-11: real bug found live (stress-fix2-1783753726) — Tier 3 tested
// `${appUrl}/api/tasks` (the FRONTEND origin) and reported "no API route
// implemented" as a finding. This project's generated apps use a SEPARATE
// frontend (Next.js) + backend (Express) architecture — there is no API
// route on the frontend by design, the frontend calls the backend directly
// (see NEXT_PUBLIC_API_URL). Tier 3 only ever knew the frontend URL, so any
// API check it attempted was against the wrong origin. Passing backendUrl
// explicitly and telling it which URL is which closes that gap.
export function buildEvidenceCollectorTask(projectId: string, appUrl: string, backendUrl: string, screenshotDir: string): string {
  return `PROJECT: ${projectId}
FRONTEND URL: ${appUrl}
BACKEND API URL: ${backendUrl}
Save browser_screenshot outputPath to RELATIVE paths under: ${screenshotDir}/ (e.g. "${screenshotDir}/dashboard.png") — never absolute paths.

Start with browser_navigate to the FRONTEND url, then DRIVE the app per your
system prompt (console errors, visible text, element checks, computed styles,
clicking primary actions, and db_query on the data layer) and produce your
FINDINGS list. Be thorough and skeptical. If the app is unreachable, that IS a
finding — report it, do not silently give up.

This project uses a SEPARATE frontend and backend — the frontend does NOT serve
API routes itself. Test API endpoints against the BACKEND API URL above, never
the frontend url; a 404/auth-redirect from the FRONTEND origin on an API-shaped
path is expected behavior, not a bug.`;
}

const REALITY_CHECKER_PROMPT = `\
You are Tilotma's Stage 2 Reality Checker — the second half of a two-stage,
evidence-based review. You did NOT write Stage 1's findings and have no memory
of how it reasoned — you only see its raw claims below. Your job is to
independently RE-DRIVE the same running app with the browser tools and verify
each claim against your OWN fresh evidence before agreeing with any of it.

You have the same tools as Stage 1: browser_navigate, browser_console_errors,
browser_get_text, browser_element_exists, browser_computed_style, browser_click,
browser_fill, browser_current_url, browser_screenshot, http_request, db_query.
Every browser_screenshot's actual image is attached to your next turn — you must
look at it, not just call it and move on. A page can read correctly in
browser_get_text's extracted DOM text while being visually broken (corrupted
glyphs, overlapping elements, a form rendered off-screen) — that gap is exactly
what a past run got wrong: a build with sitewide corrupted-glyph text ("Meñu",
"Sıqn In") passed every check and scored 7.47/10 because nothing ever actually
looked at a pixel. You are the check that closes that gap.

Be skeptical by default. Default to "NEEDS WORK" unless your own evidence
overwhelmingly supports "READY" — rubber-stamping Stage 1 without re-checking is
not doing your job.

AUTOMATIC BLOCKING FINDINGS — These ALWAYS produce VERDICT: NEEDS_WORK, never downgraded:
- "NexSidi", "NexUI", "@yugnex" visible anywhere in user-facing text (footer, navbar, badge,
  error messages, page title). This is a CONFIDENTIALITY defect, not a minor branding issue.
  The user must never see the name of the internal tooling that built their app. Any instance
  is an automatic block — do NOT classify this as minor or optional.
- Raw ISO date strings like "2026-07-13" or "2026-07-13T00:00:00" visible in the UI where
  a human-readable date (e.g., "13 Jul 2026") is expected. Users should never see ISO format.
- An unconditional status badge ("Connected", "API Connected", "Online") that appears on first
  load without an actual runtime check confirming the service is up.
- Corrupted, garbled, or mojibake text visible in a screenshot's IMAGE (wrong glyphs,
  boxes/tofu characters, mangled accented letters) even if browser_get_text extracts the
  intended string correctly — a font/encoding bug that only shows up visually is still a
  real, blocking defect. Look at the actual screenshot image for this, not the DOM text.

Specifically:
1. Re-drive the app yourself: navigate the pages, check browser_console_errors
   for 404s/JS errors, click the primary actions, and confirm redirects with
   browser_current_url. Do not trust Stage 1's description — reproduce it.
2. For each Stage 1 claim: CONFIRM it against your own tool output, DOWNGRADE it
   if it is a genuine nitpick that does not block shipping (e.g., a minor spacing
   issue), or REFUTE it if it is wrong (e.g., Stage 1 tested an api path against
   the frontend url — verify against the BACKEND api url and db_query instead).
   Also add anything real that Stage 1 missed. NEVER downgrade a Blocking Finding.
3. Conclude with a final, honest verdict grounded in what YOU observed.
4. Call task_complete. End "summary" with EXACTLY this structure:

FINDINGS:
- <issue 1, confirmed/adjusted/refuted vs Stage 1, or newly found, with the tool evidence>
- <issue 2, ...>
...
VERDICT: READY
(or)
VERDICT: NEEDS_WORK

Set verification_passed to true ONLY if your verdict is READY. Set it false if
NEEDS_WORK. It must reflect whether the app is actually ready to ship — not
merely that the review completed.
`;

export function buildRealityCheckerTask(
  projectId: string,
  appUrl: string,
  backendUrl: string,
  screenshotDir: string,
  stage1Findings: string[],
): string {
  const findingsBlock =
    stage1Findings.length > 0
      ? stage1Findings.map((f) => `- ${f}`).join("\n")
      : "(Stage 1 reported no parseable findings — treat that itself with suspicion and check thoroughly.)";

  return `PROJECT: ${projectId}
FRONTEND URL: ${appUrl}
BACKEND API URL: ${backendUrl}
Save browser_screenshot outputPath to RELATIVE paths under: ${screenshotDir}/ (e.g. "${screenshotDir}/recheck-dashboard.png") — never absolute paths.

STAGE 1'S RAW FINDINGS (independently RE-DRIVE the app and verify/refute each
against your own tool evidence — do not assume these are accurate just because
they were written down):
${findingsBlock}

This project uses a SEPARATE frontend and backend — the frontend does NOT serve
API routes itself. Test API endpoints against the BACKEND API URL above, never
the frontend url; a 404/auth-redirect from the FRONTEND origin on an API-shaped
path is expected behavior. If Stage 1 reported a "missing API route" finding
from checking the frontend origin, it is almost certainly wrong — verify against
the backend url and db_query before repeating it.

Re-drive ${appUrl} with the browser tools, verify or refute each claim above,
look for anything Stage 1 missed, then give your final READY/NEEDS_WORK verdict
per your system prompt.`;
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
