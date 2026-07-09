// Navya — adversarial QA agent (Kimi K2.6 / MiniMax M3 via NIM)
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
// fault-isolate Navya findings to a specific agent instead of always
// defaulting to "shubham" (see stage5-adversarial-qa.ts).
import { agentChat } from "@nexsidi/llm-client";

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
}

// `deps` is injectable (defaults to the real agentChat) — matches this
// codebase's established DI pattern (Saanvi/Arjun's A7 retry, full-system
// audit) — so the retry-once logic below is unit-testable without a live
// LLM call.
export interface NavyaDeps {
  chat: typeof agentChat;
}

export async function run(
  projectId: string,
  iteration: number,
  code: string,
  deps: NavyaDeps = { chat: agentChat },
): Promise<QAResult> {
  const messages = [
    { role: "system" as const, content: QA_SYSTEM_PROMPT },
    { role: "user" as const, content: JSON.stringify({ projectId, iteration, code }) },
  ];
  const apiKey = process.env.NIM_API_KEY ?? "";

  // Found live in stress5timeout: a successful HTTP 200 with finish_reason
  // "stop" but ZERO output tokens — a transient decode flake on the free
  // tier (reproduction attempts couldn't force it deterministically; other
  // transient infra failures — a 502, a dropped socket — hit the SAME run,
  // pointing at shared-infra flakiness, not a code bug). One retry absorbs
  // a one-off blip without masking a genuinely broken model, which fails
  // the retry too and correctly falls through to the D25 default-FAIL path.
  const { content: first } = await deps.chat("navya", messages, apiKey);
  let content = first;
  if (content.trim() === "") {
    console.log("[navya] first attempt returned empty content — retrying once");
    const { content: second } = await deps.chat("navya", messages, apiKey);
    content = second;
  }

  return { agent: "navya", ...parseAndScoreFindings(content) };
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
          detail: `Navya's output could not be parsed as JSON — treating as a potential logic flaw per D25 default-FAIL. Raw output: ${content.slice(0, 200)}`,
        },
      ],
    };
  }

  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) counts[f.severity]++;
  const score = Math.max(0, 100 - counts.CRITICAL * 20 - counts.HIGH * 10 - counts.MEDIUM * 5 - counts.LOW * 1);
  return { score, passed: score >= 85, findings };
}

// Exported for direct testing of the JSON-quoting fix below (found live in
// stress5timeout — see the "run() retries once" test comment for the full
// story) and so run()'s retry logic can be unit-tested without a live call.
export const QA_SYSTEM_PROMPT = `You are Navya, an adversarial logic QA engineer. Your job is to maximize error detection, NOT to confirm correctness and NOT to suggest fixes.
Hunt specifically for: type inconsistencies, null/undefined references, algorithmic flaws (off-by-one, incorrect boundary conditions, wrong operator precedence), race conditions, and unreachable code paths.
EVIDENCE RULE: a finding must describe a CONCRETE failing scenario — the exact input, call sequence, or state that triggers it and what incorrect behavior results. Trace the actual code before flagging: "can easily fall out of sync IF..." about logic you just traced as correct is an opinion, not a finding. Do not report design trade-offs (e.g., caching vs. no caching) as defects. If you cannot construct a specific failing case, do not report it.
Score = 100 - (CRITICAL×20) - (HIGH×10) - (MEDIUM×5) - (LOW×1). Pass threshold is 85 — this is computed by the caller, not by you.
Output ONLY valid JSON with quoted keys, exactly this shape: {"findings": [{"severity": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", "category": string, "detail": string, "file": string}]}
If the code has no logic issues at all, output: {"findings": []}`;
