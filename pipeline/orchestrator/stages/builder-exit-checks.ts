// The frontend builder's own checks before it may say "done" (2026-10-24, docs/root-cause/2026-10-24-brewline.md).
// On Brewline 8 emoji findings and the missing-colour findings were raised in review, after the builder had finished: its
// instructions said "no emoji" and the checks existed, but they ran only in the review stage. The same checks now run,
// by the system, when the builder calls task_complete (last phase and fix rounds), and what they find is handed back to
// it first. Pure file reads; no model call.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildDirFor } from "../../../packages/agent-runtime/src/build-dir.ts";
import { scanProjectForEmojiUi } from "./emoji-ui-check.ts";
import { scanProjectForDeadButtons } from "./dead-ui-check.ts";
import { specColours } from "../../../agents/vanya/src/index.ts";

const SKIP = new Set(["node_modules", ".next", "dist", "build", ".git"]);

function frontendText(frontendDir: string): string {
  let text = "";
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const full = join(dir, n);
      try {
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(css|tsx?|jsx?)$/i.test(n)) text += readFileSync(full, "utf-8").toUpperCase() + "\n";
      } catch {
        // unreadable: skipped
      }
    }
  };
  walk(frontendDir);
  return text;
}

/** Every colour the approved spec names must appear somewhere in the frontend's styles or code. */
export function missingSpecColours(projectId: string): string[] {
  const dir = buildDirFor(projectId, process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds");
  const specFile = join(dir, "spec.json");
  if (!existsSync(specFile)) return [];
  let description = "";
  try {
    description = String((JSON.parse(readFileSync(specFile, "utf-8")) as { description?: string }).description ?? "");
  } catch {
    return [];
  }
  const colours = specColours({ description } as never);
  if (colours.length === 0) return [];
  const text = frontendText(join(dir, "frontend"));
  return colours.filter((c) => !text.includes(c.hex.toUpperCase())).map((c) => `${c.name} ${c.hex}`);
}

export function frontendExitChecks(projectId: string): string[] {
  const out: string[] = [];
  for (const f of scanProjectForEmojiUi(projectId)) out.push(`${f.file}: ${f.issue}`);
  for (const f of scanProjectForDeadButtons(projectId)) out.push(`${f.file}: ${f.issue}`);
  const missing = missingSpecColours(projectId);
  if (missing.length > 0) out.push(`frontend theme: the approved spec's colours are not used anywhere in the frontend: ${missing.join(", ")} — put them in the theme (app/theme-overrides.css)`);
  return out;
}
