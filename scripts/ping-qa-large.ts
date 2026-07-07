// Direct reproduction of Navya's stress5 failure: qwen/qwen3.5-122b-a10b
// returned an empty string for a large one-shot code review, with no error
// thrown (nimChat only throws on non-2xx HTTP status). This bypasses
// nimChat's typed NimResponse (which doesn't even declare finish_reason) to
// inspect the RAW response JSON directly — no guessing.
const NIM_BASE_URL = process.env.NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
const MODEL = "qwen/qwen3.5-122b-a10b";

const QA_SYSTEM_PROMPT = `You are Navya, an adversarial logic QA engineer. Your job is to maximize error detection, NOT to confirm correctness and NOT to suggest fixes.
Hunt specifically for: type inconsistencies, null/undefined references, algorithmic flaws (off-by-one, incorrect boundary conditions, wrong operator precedence), race conditions, and unreachable code paths.
Score = 100 - (CRITICAL×20) - (HIGH×10) - (MEDIUM×5) - (LOW×1). Pass threshold is 85 — this is computed by the caller, not by you.
Output ONLY JSON: { findings: [{ severity: "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", category: string, detail: string, file: string }] }
If the code has no logic issues at all, output: { findings: [] }`;

async function main(): Promise<void> {
  const apiKey = process.env.NIM_API_KEY ?? "";
  console.log("NIM_API_KEY present:", !!apiKey, "length:", apiKey.length);

  // Real generated-project size: stress5's actual QA calls carried ~80-85K
  // input tokens. Build a comparable-size synthetic blob (~320KB text ≈
  // 80K tokens at ~4 chars/token).
  const oneLine = `// FILE: backend/src/controllers/tasks.ts line filler for token-size matching\n`;
  const targetChars = 80_000 * 4; // ~80K tokens at ~4 chars/token, matching stress5's real 82-85K input calls
  const code = oneLine.repeat(Math.ceil(targetChars / oneLine.length));

  const messages = [
    { role: "system", content: QA_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify({ projectId: "diag", iteration: 1, code }) },
  ];

  const contextLimit = 32768; // current NIM_CONTEXT_LIMITS entry for this model
  const maxTokens = Math.min(16384, Math.floor(contextLimit * 0.75));
  console.log(`Sending ~${Math.round(code.length / 4)} estimated input tokens, max_tokens=${maxTokens}`);

  const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.2 }),
  });

  console.log("HTTP status:", res.status);
  const raw = await res.text();
  console.log("RAW RESPONSE (first 2000 chars):\n", raw.slice(0, 2000));

  try {
    const parsed = JSON.parse(raw);
    console.log("\nfinish_reason:", parsed.choices?.[0]?.finish_reason);
    console.log("message.content length:", parsed.choices?.[0]?.message?.content?.length);
    console.log("usage:", JSON.stringify(parsed.usage));
    console.log("error field (if any):", JSON.stringify(parsed.error));
  } catch (e) {
    console.log("Response body was not valid JSON:", String(e));
  }
}

main().catch((err) => {
  console.log("FAILED —", String(err));
  process.exit(1);
});
