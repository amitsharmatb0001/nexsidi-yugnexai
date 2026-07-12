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
  // 2026-07-11: real bug found live — Tier 3 only ever knew the frontend
  // URL and tested API endpoints against it, producing a false "no API
  // route" finding on a project whose backend lives on a separate origin.
  // Mirrors TIER3_REVIEW_URL's own override pattern.
  const backendUrl = process.env.TIER3_REVIEW_BACKEND_URL ?? "http://localhost:3001";
  const screenshotDir = join(SCREENSHOT_ROOT, projectId).replace(/\\/g, "/");
  mkdirSync(join(process.cwd(), screenshotDir), { recursive: true });

  // ── Stage 1: Evidence Collector ─────────────────────────────────────────
  const stage1 = await runAgentEscalated({
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
  });

  const stage1Findings = parseFindings(stage1.summary);

  // ── Stage 2: Reality Checker — a genuinely separate agent run ───────────
  const stage2 = await runAgentEscalated({
    agentName: "tilotma-reality-checker",
    model: AGENT_MODELS.tilotma,
    apiKey,
    systemPrompt: REALITY_CHECKER_PROMPT,
    initialMessage: buildRealityCheckerTask(projectId, appUrl, backendUrl, screenshotDir, stage1Findings),
    sandboxDir: frontendOutputDir,
    projectId,
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
  of layout/rendering. Save under the folder given in the task message.
- http_request: hit the BACKEND api url directly to confirm endpoints respond.
- db_query {query}: run a READ-ONLY SELECT against the app's database to confirm
  data (e.g. required tables/columns exist; after creating something, that a row
  appeared).

Your workflow:
1. browser_navigate to the FRONTEND url. Note any redirect. Immediately call
   browser_console_errors — report every 404 / JS error as a finding.
2. browser_get_text and browser_screenshot the landing/first page. Check for
   placeholder text, broken layout, missing header/footer (browser_element_exists),
   and slop (purple-gradient-over-white-card AI defaults). Use browser_computed_style
   on key elements to check spacing/typography concretely.
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

Be skeptical by default. Default to "NEEDS WORK" unless your own evidence
overwhelmingly supports "READY" — rubber-stamping Stage 1 without re-checking is
not doing your job. Specifically:
1. Re-drive the app yourself: navigate the pages, check browser_console_errors
   for 404s/JS errors, click the primary actions, and confirm redirects with
   browser_current_url. Do not trust Stage 1's description — reproduce it.
2. For each Stage 1 claim: CONFIRM it against your own tool output, DOWNGRADE it
   if it is a nitpick that does not block shipping, or REFUTE it if it is wrong
   (e.g. Stage 1 tested an api path against the frontend url — that is a false
   finding; verify against the BACKEND api url and db_query instead). Also add
   anything real that Stage 1 missed.
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
