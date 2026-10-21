// A different approach when the first one does not converge (patent claim 6(c)).
//
// A repair that fails once is retried as it was only if the failure looks new. When the SAME problem comes back after a
// repair, repeating the same instruction cannot be expected to help, so the next round is given a different strategy:
// one generated for these findings by a model (when switched on), otherwise the next untried one from a library of
// genuinely different approaches. Every attempt is recorded, so no approach is offered twice for the same problem.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface Strategy {
  id: string;
  title: string;
  instruction: string;
  source: "library" | "model";
}

const lib = (id: string, title: string, instruction: string): Strategy => ({ id, title, instruction, source: "library" });

export const STRATEGY_LIBRARY: Strategy[] = [
  lib(
    "root-cause-shared-layer",
    "Fix it once in the shared layer",
    "Stop patching the page where the problem shows. Find the shared code every failing case goes through (an API helper, a schema, a middleware, a shared component) and fix it there once, then check each place that uses it.",
  ),
  lib(
    "revert-and-redo-minimal",
    "Undo the last change, then redo it in the smallest step",
    "Undo the most recent change that touched the failing area and confirm the original behaviour works. Then apply the requested change again in the smallest possible step, checking after each step instead of after all of them.",
  ),
  lib(
    "rebuild-from-contract",
    "Rebuild the failing part against what the backend really answers",
    "Do not edit the failing component further. Read the controller for each request it makes, write down the exact request and response shapes, and rewrite the component from those shapes so it cannot disagree with the backend.",
  ),
  lib(
    "backend-first",
    "Prove the backend first, then fix the screen",
    "Make requests straight to the backend routes involved and confirm each answers correctly with realistic and with empty data. Only then change the screen, and change it only to match what those requests actually return.",
  ),
  lib(
    "handle-real-data",
    "Handle empty, missing and differently shaped data",
    "Look at the exact point of failure and list the inputs it receives in practice: empty lists, missing fields, null values, dates and numbers in a different format. Make the code accept each of them and show a sensible empty state instead of failing.",
  ),
  lib(
    "reduce-scope-and-report",
    "Remove only the failing part and report it",
    "If the failing part cannot be made to work safely, remove just that part and keep everything else working. End the summary with a line in the form 'Not applied: <the part> - <why it could not be done>' so the person is told.",
  ),
];

/** The first library approach whose id is not in `tried`, or null when all have been tried. */
export function pickAlternative(tried: string[]): Strategy | null {
  return STRATEGY_LIBRARY.find((s) => !tried.includes(s.id)) ?? null;
}

// ── the record of what was tried ────────────────────────────────────────────
export interface StrategyAttempt {
  at: string;
  stage: string;
  findings: string[];
  strategyId: string;
  title: string;
}

const attemptsFile = (buildDir: string) => join(buildDir, "strategies.jsonl");

export function recordAttempt(buildDir: string, attempt: Omit<StrategyAttempt, "at">): void {
  mkdirSync(buildDir, { recursive: true });
  appendFileSync(attemptsFile(buildDir), JSON.stringify({ at: new Date().toISOString(), ...attempt }) + "\n");
}

export function readAttempts(buildDir: string): StrategyAttempt[] {
  const file = attemptsFile(buildDir);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as StrategyAttempt];
      } catch {
        return [];
      }
    });
}

// ── generating one for these findings ───────────────────────────────────────
export function parseGeneratedStrategy(raw: string): Strategy | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { title?: unknown; instruction?: unknown };
    if (typeof parsed.title !== "string" || typeof parsed.instruction !== "string") return null;
    const title = parsed.title.trim();
    const instruction = parsed.instruction.trim();
    if (title.length < 5 || instruction.length < 60) return null;
    return { id: `gen-${createHash("sha256").update(title).digest("hex").slice(0, 8)}`, title, instruction, source: "model" };
  } catch {
    return null;
  }
}

export type StrategyGenerator = (findings: string[], tried: Strategy[]) => Promise<Strategy | null>;

/** A model asked for ONE approach that differs from those already tried. Only used when NEXSIDI_STRATEGY_MODEL=on. */
function modelGenerator(): StrategyGenerator | undefined {
  if (process.env.NEXSIDI_STRATEGY_MODEL !== "on") return undefined;
  return async (findings, tried) => {
    const { agentChat } = await import("@nexsidi/llm-client");
    const prompt = [
      "A repair of a generated web app did not fix these problems:",
      ...findings.slice(0, 8).map((f, i) => `${i + 1}. ${f}`),
      tried.length ? `Approaches already tried (do not repeat them):\n${tried.map((t) => `- ${t.title}: ${t.instruction}`).join("\n")}` : "",
      "Propose ONE clearly different approach. Answer with only this JSON: {\"title\": \"short name\", \"instruction\": \"what the builder should do, in two or three sentences\"}",
    ].filter(Boolean).join("\n");
    const { content } = await agentChat("tilotma", [{ role: "user", content: prompt }], process.env.NIM_API_KEY ?? "", { maxTokens: 600 });
    return parseGeneratedStrategy(content);
  };
}

export async function proposeAlternative(opts: { findings: string[]; tried: string[]; generate?: StrategyGenerator }): Promise<Strategy | null> {
  const generate = opts.generate ?? modelGenerator();
  if (generate) {
    const triedLibrary = STRATEGY_LIBRARY.filter((s) => opts.tried.includes(s.id));
    try {
      const made = await generate(opts.findings, triedLibrary);
      const repeats = made && (opts.tried.includes(made.id) || triedLibrary.some((s) => s.title === made.title));
      if (made && !repeats) return made;
    } catch {
      /* a model that is down must not stop the repair: fall back to the library */
    }
  }
  return pickAlternative(opts.tried);
}

/** The part of a hold report that points at approaches nobody has tried yet. */
export function alternativesSection(triedIds: string[]): string {
  const untried = STRATEGY_LIBRARY.filter((s) => !triedIds.includes(s.id)).slice(0, 3);
  if (untried.length === 0) return "## Different approaches\n- Every built-in approach has been tried for this project.\n";
  return ["## Different approaches to try", ...untried.map((s) => `- **${s.title}** — ${s.instruction}`), ""].join("\n");
}
