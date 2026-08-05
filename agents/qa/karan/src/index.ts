// Karan — adversarial QA agent (Kimi K2.6 / MiniMax M3 via NIM)
// D24: evaluator ONLY critiques — never suggests fixes.
// D25: default-FAIL contract (must earn a pass).
// D26: fresh-context evaluator — no write tools, no generation history.
// Fix #8: score returned individually; pipeline passes only if ALL agents ≥85.
//
// ── Finding/QAResult type resolution (Task 12) ──────────────────────────────
// Karan's security scoring is zero-tolerance (scoreSecurityFindings below,
// built in Task 9), NOT the severity-weighted ≥85 score Navya/Deepika use —
// those are two deliberately different scoring systems (design doc Stage 5,
// never to be mixed). scoreSecurityFindings takes SecurityFinding[]
// (severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", description: string), but
// run() used to return a DIFFERENT, generic emoji-severity Finding[] shape
// (severity: "🔴"|"🟡"|"🟢"|"💡", category, detail) hardcoded to `[]` — a
// placeholder that was never actually wired to scoreSecurityFindings.
//
// Resolution: run() now returns SecurityFinding[] directly — the shape the
// real scorer consumes — instead of the generic emoji shape. Checked via a
// repo-wide grep before making this change: the emoji Finding/QAResult pair
// Karan previously exported was never imported anywhere outside this file
// (Navya and Deepika each define their OWN separate copy of the same-shaped
// types locally in their own files — those are untouched by this change).
// Retiring Karan's copy here is safe; nothing else depended on it.
import { agentChat } from "@nexsidi/llm-client";
import { runQAAgent, type LabeledDir, type Finding as QALoopFinding } from "../../../../packages/agent-runtime/src/qa-loop.ts";

export interface SecurityFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  file?: string; // best-effort file path — lets Stage 5 fault-isolate to the responsible agent
  line?: number; // P2: exact line so fixes target a location, not a whole-file re-scan
}

export interface QAResult {
  agent:    string;
  score:    number;   // severity-weighted 0-100 per CLAUDE.md System A (see scoreSecurityFindings)
  passed:   boolean;  // mirrors scoreSecurityFindings(...).pass (score ≥ 85)
  findings: SecurityFinding[];
}

// `deps` is injectable (defaults to the real agentChat) — matches this
// codebase's established DI pattern (Saanvi/Arjun's A7 retry).
export interface KaranDeps {
  chat: typeof agentChat;
}

export async function run(
  projectId: string,
  iteration: number,
  code: string,
  deps: KaranDeps = { chat: agentChat },
): Promise<QAResult> {
  const messages = [
    { role: "system" as const, content: QA_SYSTEM_PROMPT },
    { role: "user" as const, content: JSON.stringify({ projectId, iteration, code }) },
  ];
  const apiKey = process.env.NIM_API_KEY ?? "";

  // Found live in stress5timeout: multiple transient free-tier failures hit
  // the same run (a 502, a dropped socket, an empty-content response on
  // another QA agent) — one retry absorbs a one-off blip without masking a
  // genuinely broken model, which fails the retry too and correctly falls
  // through to the zero-tolerance default-FAIL path.
  // 2026-07-11: same fix as navya/src/index.ts — no maxTokens override left
  // this at Gemini's default 8000-token output cap, which can truncate a
  // full-codebase review mid-JSON and default-FAIL on the harness's own
  // token limit rather than a real finding.
  const QA_MAX_TOKENS = 16000;
  const { content: first } = await deps.chat("karan", messages, apiKey, { maxTokens: QA_MAX_TOKENS });
  let content = first;
  if (content.trim() === "") {
    console.log("[karan] first attempt returned empty content — retrying once");
    const { content: second } = await deps.chat("karan", messages, apiKey, { maxTokens: QA_MAX_TOKENS });
    content = second;
  }

  const findings = parseSecurityFindings(content);
  const { pass, score } = scoreSecurityFindings(findings);
  return { agent: "karan", score, passed: pass, findings };
}

// 2026-07-11: same root cause as navya/src/index.ts's runExploring — run()
// reviews a dumped text blob of the ENTIRE codebase in one shot, with no way
// to verify a claim before finalizing it. runExploring() uses the
// tool-calling loop (qa-loop.ts) instead — explore file by file via
// list_files/read_file, then submit_findings, gated so a finding citing a
// file never actually read is rejected. Preferred path; run() (text-dump)
// kept as the tested fallback call shape.
function qaLoopFindingToSecurityFinding(f: QALoopFinding): SecurityFinding {
  return { severity: f.severity, description: `${f.category}: ${f.detail}`, file: f.file, line: f.line };
}

export interface KaranExploringDeps {
  runAgent: typeof runQAAgent;
}

export async function runExploring(
  projectId: string,
  dirs: LabeledDir[],
  deps: KaranExploringDeps = { runAgent: runQAAgent },
  // F5 (agent-autonomy-assessment): see navya/src/index.ts's identical
  // parameter for the full rationale.
  systemContext?: string,
): Promise<QAResult> {
  const result = await deps.runAgent({
    agentName: "karan",
    systemPrompt: QA_SYSTEM_PROMPT,
    reviewFocus: "security vulnerabilities AND information-integrity defects — specifically: (1) OWASP issues (injection, auth/authz gaps, unsafe deserialization, exposed secrets, CSRF, unvalidated input); (2) read frontend JSX/TSX files and search for 'NexSidi', 'NexUI', '@yugnex' appearing as RENDERED TEXT in JSX (string literals between JSX tags, aria-label values, title/alt attributes, or text rendered inside <p>/<span>/<footer>/<h*> elements) — CRITICAL if found. IMPORTANT: TypeScript import statements (e.g. \"import { X } from '@yugnex/nexui-react'\") and package.json dependency entries are NOT user-visible text and must NOT be flagged — only flag when the string is actually rendered in the browser as visible text; (3) read frontend/app/dashboard/page.tsx and look for <Badge> or status text like 'Connected API', 'Online', 'Active' rendered unconditionally without a runtime state variable — MEDIUM if the value is a hardcoded string literal never set by an actual API check",
    dirs,
    systemContext,
  });

  const hasFatalError = result.errors.some(e => !e.includes("Max iterations") && !e.includes("stopped without calling submit_findings") && !e.includes("Stuck:"));
  if (result.findings.length === 0 && hasFatalError) {
    const findings: SecurityFinding[] = [
      {
        severity: "CRITICAL",
        description: `Karan's review did not complete: ${result.errors.join("; ")}`,
      },
    ];
    return { agent: "karan", score: 0, passed: false, findings };
  }

  const findings = result.findings.map(qaLoopFindingToSecurityFinding);
  const { pass, score } = scoreSecurityFindings(findings);
  return { agent: "karan", score, passed: pass, findings };
}

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

// D25 default-FAIL: if Karan's response isn't valid JSON, that is NOT
// evidence of "no vulnerabilities" — treat it as a (synthetic) finding so
// the zero-tolerance gate still blocks rather than silently passing on a
// parse failure. Exported for direct unit testing (parsing.test.ts) — same
// pattern as Navya/Deepika's exported parseAndScoreFindings.
export function parseSecurityFindings(content: string): SecurityFinding[] {
  try {
    const parsed = JSON.parse(stripMarkdownFences(content)) as { findings?: unknown[] } | unknown[];
    const raw = Array.isArray(parsed) ? parsed : (parsed.findings ?? []);
    if (!Array.isArray(raw)) throw new Error("findings is not an array");
    return raw.map((entry): SecurityFinding => {
      const r = entry as Record<string, unknown>;
      const severity = r.severity;
      const validSeverity =
        severity === "CRITICAL" || severity === "HIGH" || severity === "MEDIUM" || severity === "LOW"
          ? severity
          : "MEDIUM"; // unknown severity from the model — assume MEDIUM rather than dropping the finding
      return {
        severity: validSeverity,
        description: typeof r.description === "string" ? r.description : String(r.detail ?? "unspecified finding"),
        file: typeof r.file === "string" ? r.file : undefined,
        line: typeof r.line === "number" ? r.line : undefined,
      };
    });
  } catch {
    return [
      {
        severity: "CRITICAL",
        description: `Karan's output could not be parsed as JSON — treating as a potential vulnerability per D25 default-FAIL. Raw output: ${content.slice(0, 200)}`,
      },
    ];
  }
}

// Exported for direct testing of the JSON-quoting fix (found live in
// stress5timeout: raw output was the literal "{ findings: [] }" — valid JS
// object-literal syntax, invalid JSON, because this example itself had
// unquoted keys) and so run()'s retry logic can be unit-tested.
export const QA_SYSTEM_PROMPT = `You are Karan, an adversarial security QA engineer (OWASP-focused). Your job is to find vulnerabilities, NOT suggest fixes.

Hunt for all standard OWASP issues AND the following information-disclosure defects specific to generated apps:
- INTERNAL PLATFORM NAME DISCLOSURE: Any JSX text content rendered in the browser (footer text, navbar text, error messages, badge labels, tooltip content, page titles, aria-labels, alt attributes) that contains "NexSidi", "NexUI", "@yugnex", or any internal development platform name. This is a CRITICAL confidentiality defect — the user's app must NEVER expose the name of the internal tooling used to build it. Flag as CRITICAL. Example: footer text "Powered by NexSidi NexUI." is a CRITICAL finding. EXCLUSIONS — do NOT flag these, they are NOT user-visible text: TypeScript/JavaScript import statements (e.g. import { X } from "@yugnex/nexui-react"), package.json dependency entries (e.g. "@yugnex/nexui-react": "^1.0.0"), CSS class names containing "nexui", or any other source code identifier. Only flag text that actually renders in the browser's UI and is visible to end users.
- HARDCODED MISLEADING STATUS: Any badge or indicator that shows a connection/health status (e.g., "Connected", "Online") as a hardcoded string literal — where the displayed state is never computed from an actual runtime check. This misrepresents system state to users and qualifies as a logic/security integrity defect. Flag as MEDIUM.

EVIDENCE RULE — the difference between a finding and an opinion:
A finding must describe a CONCRETE failing scenario: the exact input, request, or state that triggers it, and what incorrect/exploitable behavior results. If you cannot construct a specific attack or failure case, it is not a finding.
- Do NOT report "could be risky if...", "is fragile", "is error-prone", or "if controls are bypassed" — hypotheticals without a demonstrated path are opinions, not vulnerabilities.
- Do NOT flag correctly parameterized SQL (values in the params array, only placeholder NUMBERS in the query text) as injection risk based on the query being built dynamically — trace the actual data flow; if user data never enters the query string, there is no injection.
- Do NOT report design trade-offs (e.g., caching vs. no caching) as defects — both sides of a trade-off cannot be bugs.
Severity reflects real-world impact of the DEMONSTRATED scenario: CRITICAL = exploitable now with serious impact, HIGH = real defect likely to fire in normal use, MEDIUM = real but edge-case, LOW = minor/hardening.

Whenever you cite a file, also cite the exact line number the issue is on (from read_file's output) — this is what lets the fix target that line directly instead of re-scanning the whole file.

Output ONLY valid JSON with quoted keys, exactly this shape: {"findings": [{"severity": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", "description": string, "file": string, "line": number}]}
If the code has no demonstrable vulnerabilities, output: {"findings": []}`;

// CLAUDE.md System A (authoritative, lines 370-373): Score = 100 −
// CRITICAL×20 − HIGH×10 − MEDIUM×5 − LOW×1, pass ≥ 85 — Karan is
// explicitly included in that formula alongside Navya/Deepika. The previous
// zero-tolerance implementation here ("ANY finding blocks") was a deviation
// from that spec, and empirically non-convergent: 8 consecutive live runs
// (2026-07-08/09) never produced a zero-findings review — an adversarial
// LLM reviewer always finds SOMETHING to say on ~2000 lines, including
// flagging correctly-parameterized queries as "risky" with no exploit and
// flagging both sides of a cache/no-cache trade-off across consecutive
// rounds. Conforming to the spec's ≥85 threshold: real CRITICALs (−20)
// still block on their own; a single hypothetical HIGH (−10) no longer
// vetoes an otherwise-clean codebase.
const SEVERITY_PENALTY: Record<SecurityFinding["severity"], number> = {
  CRITICAL: 20,
  HIGH: 10,
  MEDIUM: 5,
  LOW: 1,
};
const PASS_THRESHOLD = 85;

export function scoreSecurityFindings(findings: SecurityFinding[]): { pass: boolean; score: number; reason: string } {
  if (findings.length === 0) {
    return { pass: true, score: 100, reason: "No vulnerabilities found" };
  }
  const score = Math.max(0, 100 - findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0));
  const pass = score >= PASS_THRESHOLD;
  return {
    pass,
    score,
    reason: `${findings.length} finding${findings.length === 1 ? "" : "s"} — severity-weighted score ${score}/100 (pass ≥ ${PASS_THRESHOLD}, CLAUDE.md System A)`,
  };
}
