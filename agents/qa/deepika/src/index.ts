// Deepika — adversarial QA agent (Kimi K2.6 / MiniMax M3 via NIM)
// D24: evaluator ONLY critiques — never suggests fixes.
// D25: default-FAIL contract (must earn a pass).
// D26: fresh-context evaluator — no write tools, no generation history.
// Fix #8: score returned individually; pipeline passes only if ALL agents ≥85.
//
// ── Real parsing (Task 14) ───────────────────────────────────────────────────
// Previously `run()` called agentChat for real but discarded the response and
// hardcoded `score = 100, findings: []` — a no-op dressed up as a passing QA
// result. This mirrors Karan's fix (Task 9, agents/qa/karan/src/index.ts):
// parse the model's JSON output for real, compute score from the parsed
// findings (never trust a self-reported score), default-FAIL on parse
// failure. Severity changed from emoji to CRITICAL/HIGH/MEDIUM/LOW to match
// the scoring formula already documented above (they didn't match before)
// and Karan's SecurityFinding convention. `file?` added so Stage 5 can
// fault-isolate Deepika findings to a specific agent instead of always
// defaulting to "shubham" (see stage5-adversarial-qa.ts).
import { agentChat } from "@nexsidi/llm-client";
import { runQAAgent, type LabeledDir } from "../../../../packages/agent-runtime/src/qa-loop.ts";

export interface QAResult {
  agent:    string;
  score:    number;   // 0-100: Score = 100 - (CRITICAL×20) - (HIGH×10) - (MEDIUM×5) - (LOW×1)
  passed:   boolean;  // score >= 85
  findings: Finding[];
}

export interface Finding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  detail:   string;
  file?:    string; // best-effort file path — lets Stage 5 fault-isolate to the responsible agent
  line?:    number; // P2: exact line so fixes target a location, not a whole-file re-scan
}

// `deps` is injectable (defaults to the real agentChat) — matches this
// codebase's established DI pattern (Saanvi/Arjun's A7 retry).
export interface DeepikaDeps {
  chat: typeof agentChat;
}

export async function run(
  projectId: string,
  iteration: number,
  code: string,
  deps: DeepikaDeps = { chat: agentChat },
): Promise<QAResult> {
  const messages = [
    { role: "system" as const, content: QA_SYSTEM_PROMPT },
    { role: "user" as const, content: JSON.stringify({ projectId, iteration, code }) },
  ];
  const apiKey = process.env.NIM_API_KEY ?? "";

  // Found live in stress5timeout on a sibling QA agent (empty content, HTTP
  // 200, finish_reason "stop") — one retry absorbs a one-off infra blip
  // without masking a genuinely broken model, which fails the retry too.
  // 2026-07-11: same fix as navya/src/index.ts — no maxTokens override left
  // this at Gemini's default 8000-token output cap, which can truncate a
  // full-codebase review mid-JSON and default-FAIL on the harness's own
  // token limit rather than a real finding.
  const QA_MAX_TOKENS = 16000;
  const { content: first } = await deps.chat("deepika", messages, apiKey, { maxTokens: QA_MAX_TOKENS });
  let content = first;
  if (content.trim() === "") {
    console.log("[deepika] first attempt returned empty content — retrying once");
    const { content: second } = await deps.chat("deepika", messages, apiKey, { maxTokens: QA_MAX_TOKENS });
    content = second;
  }

  return { agent: "deepika", ...parseAndScoreFindings(content) };
}

// 2026-07-11: real bug found live (stress-fix2-1783753726) — run() reviews
// a single dumped text blob of the ENTIRE codebase in one shot, with no way
// to verify a claim before finalizing it. Root-caused: Deepika/Navya both
// produced findings that didn't match the actual code (pattern-matching on
// "this shape of code usually has this bug", not verified tracing).
// runExploring() uses the tool-calling loop (qa-loop.ts) instead — explore
// file by file via list_files/read_file, then submit_findings, gated so a
// finding citing a file never actually read is rejected. This is the
// preferred path; run() (text-dump) is kept for now as the tested fallback
// call shape until stage5-adversarial-qa.ts's real entry point is confirmed
// stable on the new path across a live run.
export interface DeepikaExploringDeps {
  runAgent: typeof runQAAgent;
}

export async function runExploring(
  projectId: string,
  dirs: LabeledDir[],
  deps: DeepikaExploringDeps = { runAgent: runQAAgent },
  // F5 (agent-autonomy-assessment): see navya/src/index.ts's identical
  // parameter for the full rationale — this is also what lets Deepika stop
  // re-flagging "missing index" as HIGH every round with no scale context.
  systemContext?: string,
): Promise<QAResult> {
  const result = await deps.runAgent({
    agentName: "deepika",
    systemPrompt: QA_SYSTEM_PROMPT,
    reviewFocus: "performance issues (Big-O complexity blowups, memory leaks, N+1 query patterns, blocking synchronous calls on the hot path)",
    dirs,
    systemContext,
    // 2026-08-13 (cost-control Task 1): see navya/src/index.ts's identical
    // change for the full rationale.
    projectId,
  });

  const hasFatalError = result.errors.some(e => !e.includes("Max iterations") && !e.includes("stopped without calling submit_findings") && !e.includes("Stuck:"));
  if (result.findings.length === 0 && hasFatalError) {
    // D25 default-FAIL: the agent never successfully called submit_findings
    // (gave up, hit the iteration cap) — categorically worse than "zero
    // findings", so this is NOT the same as a clean pass.
    return {
      agent: "deepika",
      score: 0,
      passed: false,
      findings: [
        {
          severity: "CRITICAL",
          category: "review-incomplete",
          detail: `Deepika's review did not complete: ${result.errors.join("; ")}`,
        },
      ],
    };
  }

  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of result.findings) counts[f.severity]++;
  const score = Math.max(0, 100 - counts.CRITICAL * 20 - counts.HIGH * 10 - counts.MEDIUM * 5 - counts.LOW * 1);
  return { agent: "deepika", score, passed: score >= 85, findings: result.findings };
}

// D25 default-FAIL: unparseable output is never treated as "everything's
// fine" — it becomes a synthetic CRITICAL finding that fails the check.
// Score is ALWAYS computed from the parsed findings, never trusted from a
// `score` field the model might self-report.
// Strips a wrapping ```json / ``` markdown code fence, if present — found in
// stress-test 1 (F7): despite "Output ONLY JSON", the model's real output was
// wrapped in fences, tripping the D25 default-FAIL path even though the
// underlying JSON was well-formed. Returns the trimmed input unchanged when
// no fence wrapper is present.
function stripMarkdownFences(content: string): string {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1]! : trimmed;
}

export function parseAndScoreFindings(content: string): { score: number; passed: boolean; findings: Finding[] } {
  let findings: Finding[];
  try {
    const parsed = JSON.parse(stripMarkdownFences(content)) as { findings?: unknown[] } | unknown[];
    const raw = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
    if (!Array.isArray(raw)) throw new Error("findings is not an array");
    findings = raw.map((entry): Finding => {
      const r = entry as Record<string, unknown>;
      const severity = r.severity;
      const validSeverity =
        severity === "CRITICAL" || severity === "HIGH" || severity === "MEDIUM" || severity === "LOW"
          ? severity
          : "MEDIUM"; // unknown severity from the model — assume MEDIUM rather than dropping the finding
      return {
        severity: validSeverity,
        category: typeof r.category === "string" ? r.category : "unspecified",
        detail: typeof r.detail === "string" ? r.detail : "unspecified finding",
        file: typeof r.file === "string" ? r.file : undefined,
        line: typeof r.line === "number" ? r.line : undefined,
      };
    });
  } catch {
    // D25 default-FAIL: score is forced to 0 here, NOT run through the
    // normal weighted formula (a lone CRITICAL would score 80, which already
    // fails the ≥85 threshold — so this isn't needed to prevent a silent
    // pass). It's forced to 0 regardless, because an unparseable response is
    // categorically worse than "one confirmed critical bug": it means the
    // review didn't happen at all, and should read as the worst possible
    // outcome, not just barely-failing.
    return {
      score: 0,
      passed: false,
      findings: [
        {
          severity: "CRITICAL",
          category: "parse-failure",
          detail: `Deepika's output could not be parsed as JSON — treating as a potential performance issue per D25 default-FAIL. Raw output: ${content.slice(0, 200)}`,
        },
      ],
    };
  }

  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) counts[f.severity]++;
  const score = Math.max(0, 100 - counts.CRITICAL * 20 - counts.HIGH * 10 - counts.MEDIUM * 5 - counts.LOW * 1);
  return { score, passed: score >= 85, findings };
}

// Exported for direct testing of the JSON-quoting fix (same bug found live
// in Karan/Navya: unquoted keys in this example taught the model invalid
// JS-object-literal syntax instead of JSON) and so run()'s retry logic can
// be unit-tested.
export const QA_SYSTEM_PROMPT = `You are Deepika, an adversarial performance QA engineer. Your job is to maximize error detection, NOT to confirm correctness and NOT to suggest fixes.
Hunt specifically for: Big-O complexity blowups (nested loops over large collections, quadratic-or-worse algorithms), memory leaks (via allocation pattern analysis — unbounded caches, listeners never removed, closures retaining large objects), and N+1 query patterns or blocking synchronous calls on the hot path.
EVIDENCE RULE: a finding must describe a CONCRETE degradation scenario — the specific workload (N requests, M rows) and the measurable consequence. A single indexed DB query per request in auth middleware is a normal web-app pattern, not an N+1 finding. Do not report design trade-offs (e.g., caching vs. no caching — flagging BOTH the presence and absence of a cache is contradictory) as defects. If you cannot describe the concrete workload where it degrades, do not report it.
Whenever you cite a file, also cite the exact line number the issue is on (from read_file's output) — this is what lets the fix target that line directly instead of re-scanning the whole file.
Score = 100 - (CRITICAL×20) - (HIGH×10) - (MEDIUM×5) - (LOW×1). Pass threshold is 85 — this is computed by the caller, not by you.
Output ONLY valid JSON with quoted keys, exactly this shape: {"findings": [{"severity": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", "category": string, "detail": string, "file": string, "line": number}]}
If the code has no performance issues at all, output: {"findings": []}`;
