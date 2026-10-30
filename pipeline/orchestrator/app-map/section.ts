// The shared record (2026-10-30, understanding plan step 4): the reviewers and the Chief AI each read the code on their own,
// and none of them saw what the others, or the system's checks, already knew. This section gives them the same facts: the
// app as the system read it from the code (app-map), and the rules the system's checks already found broken, so a reviewer
// spends its one review on what the checks cannot see.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildAppMap, renderAppMap } from "./index.ts";
import { checkRules, ruleFindings } from "./rules.ts";

/** "" when the folder has no code the map can read. */
export function mapSection(projectDir: string, opts: { maxChars?: number } = {}): string {
  if (!existsSync(join(projectDir, "backend")) && !existsSync(join(projectDir, "frontend")) && !existsSync(join(projectDir, "db"))) return "";
  try {
    const map = buildAppMap(projectDir);
    // The whole section stays within maxChars: the broken rules first (a third at most), the map in what is left.
    const max = opts.maxChars ?? 12_000;
    const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, Math.max(0, n))}\n… (cut at ${n} of ${text.length} characters)` : text);
    const broken = ruleFindings(checkRules(projectDir, map));
    const brokenText = cut(
      broken.length
        ? `ALREADY FOUND BY THE SYSTEM'S CHECKS (they go to the builders anyway; do not report them again):\n${broken.map((b) => `- ${b}`).join("\n")}`
        : "ALREADY FOUND BY THE SYSTEM'S CHECKS: none of the rules it checks is broken.",
      Math.floor(max / 3),
    );
    const head = "THE APP, READ FROM ITS CODE BY THE SYSTEM (facts from the syntax tree and the migrations, not opinions; where your reading differs, the code decides):";
    const render = cut(renderAppMap(map), max - brokenText.length - head.length);
    return ["", head, render, "", brokenText].join("\n");
  } catch (err) {
    console.warn(`[app-map] the shared record could not be built: ${String(err).slice(0, 160)}`);
    return "";
  }
}
