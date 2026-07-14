// run-evals.ts — provider-agnostic skill eval runner for NexSidi
// Works against ANY OpenAI-compatible /chat/completions endpoint:
// open-source (vLLM/Ollama/llama.cpp server), NIM, Gemini (OpenAI compat),
// Anthropic (via compat proxy), or in-house models.
//
// Usage:
//   bun run run-evals.ts \
//     --base-url http://localhost:11434/v1 \
//     --model qwen2.5-coder:7b \
//     --api-key $KEY \
//     --skill ../nexsidi-core-reasoning/SKILL.md \
//     --evals ../evals/core-reasoning.json \
//     --runs 3 [--baseline]
//
// --baseline: run WITHOUT the skill injected (to measure skill effect).
// Results written to evals/results/<skill>__<model>__<date>.json

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { basename, join, dirname } from "path";

// ── args ─────────────────────────────────────────────────────────────
function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing required arg --${name}`);
  process.exit(1);
}
const BASE_URL = arg("base-url");
const MODEL = arg("model");
const API_KEY = arg("api-key", process.env.EVAL_API_KEY ?? "");
const SKILL_PATH = arg("skill");
const EVALS_PATH = arg("evals");
const RUNS = parseInt(arg("runs", "3"), 10);
const BASELINE = process.argv.includes("--baseline");

// ── types ────────────────────────────────────────────────────────────
type Assertion =
  | { type: "must_contain"; value: string }
  | { type: "must_not_contain"; value: string }
  | { type: "must_match"; value: string }        // regex, case-insensitive
  | { type: "first_line_is"; value: string }
  | { type: "valid_json_with_keys"; value: string[] };

interface EvalCase { id: string; prompt: string; assertions: Assertion[]; }
interface EvalSet { skill: string; cases: EvalCase[]; }

// ── assertion checking (mechanical — no grader model needed) ─────────
function check(a: Assertion, output: string): boolean {
  const out = output.trim();
  switch (a.type) {
    case "must_contain":
      return out.toLowerCase().includes(a.value.toLowerCase());
    case "must_not_contain":
      return !out.toLowerCase().includes(a.value.toLowerCase());
    case "must_match":
      return new RegExp(a.value, "i").test(out);
    case "first_line_is":
      return out.split("\n")[0].trim() === a.value;
    case "valid_json_with_keys": {
      // find the last {...} block in the output and validate keys
      const m = out.match(/\{[\s\S]*\}/g);
      if (!m) return false;
      try {
        const obj = JSON.parse(m[m.length - 1]);
        return a.value.every((k) => k in obj);
      } catch { return false; }
    }
  }
}

// ── model call (OpenAI-compatible, provider-agnostic) ────────────────
async function callModel(system: string, user: string): Promise<string> {
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      max_tokens: 1500,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ── main ─────────────────────────────────────────────────────────────
const skillText = BASELINE ? "" : readFileSync(SKILL_PATH, "utf8");
const evalSet: EvalSet = JSON.parse(readFileSync(EVALS_PATH, "utf8"));

const results: any = {
  skill: evalSet.skill,
  model: MODEL,
  baseUrl: BASE_URL,
  baseline: BASELINE,
  runsPerCase: RUNS,
  date: new Date().toISOString(),
  cases: [] as any[],
};

let totalPass = 0, totalRuns = 0;

for (const c of evalSet.cases) {
  const caseResult = { id: c.id, runs: [] as any[], passRate: 0 };
  let passes = 0;
  for (let r = 0; r < RUNS; r++) {
    let output = "", error = "";
    try { output = await callModel(skillText, c.prompt); }
    catch (e: any) { error = String(e?.message ?? e); }
    const failed = error
      ? c.assertions.map((a) => a) // all fail on transport error
      : c.assertions.filter((a) => !check(a, output));
    const pass = !error && failed.length === 0;
    if (pass) passes++;
    caseResult.runs.push({
      pass,
      failedAssertions: failed,
      error: error || undefined,
      outputPreview: output.slice(0, 400),
    });
  }
  caseResult.passRate = passes / RUNS;
  totalPass += passes; totalRuns += RUNS;
  results.cases.push(caseResult);
  console.log(
    `${caseResult.passRate === 1 ? "✓" : caseResult.passRate > 0 ? "~" : "✗"} ` +
    `${c.id}  ${passes}/${RUNS}`
  );
}

results.score = Math.round((totalPass / totalRuns) * 100);
console.log(`\nSCORE: ${results.score}/100  (${BASELINE ? "BASELINE — no skill" : "WITH skill"})`);
console.log(`Compare baseline vs with-skill on the SAME model to get the skill's effect.`);

const outDir = join(dirname(EVALS_PATH), "results");
mkdirSync(outDir, { recursive: true });
const tag = BASELINE ? "baseline" : "skill";
const outPath = join(
  outDir,
  `${evalSet.skill}__${MODEL.replace(/[^a-z0-9.-]/gi, "_")}__${tag}__${new Date().toISOString().slice(0, 10)}.json`
);
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`Results → ${outPath}`);
