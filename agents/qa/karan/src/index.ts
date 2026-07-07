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

export interface SecurityFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
  file?: string; // best-effort file path — lets Stage 5 fault-isolate to the responsible agent
}

export interface QAResult {
  agent:    string;
  score:    number;   // 100 if scoreSecurityFindings passed, 0 otherwise — zero-tolerance, not weighted
  passed:   boolean;  // mirrors scoreSecurityFindings(...).pass
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
  const { content: first } = await deps.chat("karan", messages, apiKey);
  let content = first;
  if (content.trim() === "") {
    console.log("[karan] first attempt returned empty content — retrying once");
    const { content: second } = await deps.chat("karan", messages, apiKey);
    content = second;
  }

  const findings = parseSecurityFindings(content);
  const { pass } = scoreSecurityFindings(findings);
  return { agent: "karan", score: pass ? 100 : 0, passed: pass, findings };
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
Zero-tolerance policy: ANY finding blocks release, regardless of severity — there is no passing score to earn, only "vulnerabilities found" or "none found".
Output ONLY valid JSON with quoted keys, exactly this shape: {"findings": [{"severity": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", "description": string, "file": string}]}
If the code has no vulnerabilities at all, output: {"findings": []}`;

// Zero-tolerance: unlike Navya/Deepika's severity-weighted ≥85 score, ANY
// security finding blocks — matches the design doc's "0.1% tolerance" policy.
export function scoreSecurityFindings(findings: SecurityFinding[]): { pass: boolean; reason: string } {
  if (findings.length === 0) {
    return { pass: true, reason: "No vulnerabilities found" };
  }
  return { pass: false, reason: `${findings.length} vulnerabilit${findings.length === 1 ? "y" : "ies"} found — zero-tolerance policy blocks any finding` };
}
