import { test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// 2026-10-04 (evidence-only plan, hard guard; approved by Amit): the system
// never guesses. This fails the build if an instruction or check gives
// permission to fill a gap with a default, a judgement, or a pass. Missing
// input is asked for, an unchecked check is "not checked" (see
// docs/nexsidi/plans/2026-10-03-evidence-only.md).
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCAN = ["packages/agent-runtime/skills", "agents", "pipeline/orchestrator", "pipeline/activities", "packages/agent-runtime/src"];

const BANNED: Array<{ name: string; pattern: RegExp; why: string }> = [
  { name: "sensible-default", pattern: /sensible default/i, why: "an agent must not pick a default for missing input — ask or report blocked" },
  { name: "judgement", pattern: /best judge?ment|use your judge?ment/i, why: "decisions come from facts, not judgement calls" },
  { name: "default-on-doubt", pattern: /default to no auth|(if|when) in doubt,? (default|assume)/i, why: "a requirement is the user's to state — ask" },
  { name: "assumption", pattern: /reasonable assumption|make an assumption|assume (it|this|that) (is|passes|works)/i, why: "assumptions are not evidence" },
  { name: "fail-open", pattern: /\(fail-open\)|skipping \(fail-open|fails? open on/i, why: "a check that could not run is 'not checked', never a pass" },
];

// Open decisions Amit has not answered yet — listed here so nothing else slips in.
const OPEN: Array<{ file: string; rule: string; decision: string }> = [
  {
    file: "packages/agent-runtime/skills/shubham/20-critical-rules-and-verification.md",
    rule: "sensible-default",
    decision: "admin account for apps without sign-up: system-written .env, or given at spec approval",
  },
];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(md|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

test("no instruction or check gives permission to guess", () => {
  const hits: string[] = [];
  for (const dir of SCAN) {
    for (const file of files(join(ROOT, dir))) {
      const rel = relative(ROOT, file).split("\\").join("/");
      const text = readFileSync(file, "utf-8");
      for (const rule of BANNED) {
        if (!rule.pattern.test(text)) continue;
        if (OPEN.some((o) => o.file === rel && o.rule === rule.name)) continue;
        hits.push(`${rel}: ${rule.name} — ${rule.why}`);
      }
    }
  }
  expect(hits).toEqual([]);
});

test("every open decision is still open (remove it from the list once Amit decides)", () => {
  for (const o of OPEN) {
    const rule = BANNED.find((r) => r.name === o.rule)!;
    expect({ file: o.file, stillThere: rule.pattern.test(readFileSync(join(ROOT, o.file), "utf-8")) }).toEqual({ file: o.file, stillThere: true });
  }
});
