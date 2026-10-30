// Mistake memory by facts (2026-10-30, team plan stage 7 — Amit: "by facts, in code", no vectors). A repeat was recognised
// only when a model's summary of a finding came out word for word the same, so the store held 595 patterns each seen once
// and its statistics (claim 7) had nothing to count. A broken rule on the app map has a key from its facts — the rule and the
// kind of break — that is the same in every project whatever the tables are called or the finding says. Each build records a
// key once; the store counts it across projects, and the builders read back the patterns seen in the most projects first.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuleViolation } from "./rules.ts";

export interface MistakePattern {
  /** "<rule>/<kind>", e.g. INT1/no-copy */
  key: string;
  domain: "security" | "architecture" | "code-style";
  /** the same words for every project: what to do instead */
  guidance: string;
}

const GUIDANCE: Record<string, string> = {
  "INT1/no-copy": "An order, invoice or booking line keeps its own copy of the item's name and price (columns on the line, written on insert).",
  "INT1/cascade": "A line's reference to the item it sold is ON DELETE RESTRICT or SET NULL, never CASCADE.",
  "INT1/insert-without-copy": "Every insert of an order line writes the item's name and price into the line's own columns.",
  "INT1/read-current": "Order history reads the name and price the line recorded, never the item's current values.",
  "INT1/inner-join-hides": "When deleting an item empties the line's reference, history reads use LEFT JOIN to the item.",
  "INT2/no-transaction": "A stock or availability check and the write after it run in one transaction.",
  "INT2/no-lock": "Inside the transaction, the checked rows are read with SELECT ... FOR UPDATE.",
  "SEC1/sql-from-request": "No request value is built into SQL text: values go in the parameters; only fixed column names go into the text.",
  "SEC2/no-sign-in": "Every endpoint the contract marks as signed-in has the sign-in check before its handler.",
  "SEC2/no-role-check": "Every role-limited endpoint checks the caller's role before its handler.",
  "SEC9/role-from-request": "No endpoint lets the caller choose a role: sign-up sets the lowest role in code; staff come from a seed or an existing staff account.",
  "MAP/unknown-column": "SQL names only tables and columns the migrations create.",
  "MAP/schema-file-differs": "The schema file lists exactly the columns the migrations create.",
  "MAP/contract-endpoint-not-served": "The backend serves every endpoint of the approved contract at its exact path.",
  "MAP/call-outside-contract": "The frontend calls only endpoints of the approved contract, at their exact paths.",
};

const DOMAIN: Record<RuleViolation["rule"], MistakePattern["domain"]> = { SEC1: "security", SEC2: "security", SEC9: "security", INT1: "architecture", INT2: "architecture", MAP: "code-style" };

/** One pattern per key, in the order first seen. */
export function mistakePatterns(violations: RuleViolation[]): MistakePattern[] {
  const out = new Map<string, MistakePattern>();
  for (const v of violations) {
    const key = `${v.rule}/${v.kind}`;
    if (!out.has(key)) out.set(key, { key, domain: DOMAIN[v.rule], guidance: GUIDANCE[key] ?? v.fix });
  }
  return [...out.values()];
}

type Recorder = (agentName: string, domain: string, trigger: string, action: string, projectId?: string) => Promise<void>;

const RECORDED = "mistake-patterns.json";

/**
 * Records each key once per build (the file in the build folder remembers which), whoever broke it and however many times
 * they said "done". The store is an enrichment: when it cannot be reached, the build goes on.
 */
export async function recordMistakePatterns(projectDir: string, projectId: string, agentName: string, violations: RuleViolation[], record?: Recorder): Promise<void> {
  const file = join(projectDir, RECORDED);
  let done: string[] = [];
  try {
    if (existsSync(file)) done = JSON.parse(readFileSync(file, "utf-8")) as string[];
  } catch {
    done = [];
  }
  const fresh = mistakePatterns(violations).filter((p) => !done.includes(p.key));
  if (fresh.length === 0) return;
  // Tests never write to the platform's store (run from the repo root, they reach the real database).
  if (!record && process.env.NODE_ENV === "test") return;
  try {
    const rec: Recorder = record ?? (async (a, d, t, act, p) => {
      const { recordInstinct } = await import("@nexsidi/db");
      await recordInstinct(a, d as never, t, act, p);
    });
    for (const p of fresh) await rec(agentName, p.domain, p.key, p.guidance, projectId);
    writeFileSync(file, JSON.stringify([...done, ...fresh.map((p) => p.key)]));
  } catch (err) {
    console.log(`[mistakes] not recorded (memory is an enrichment): ${String(err).slice(0, 160)}`);
  }
}
