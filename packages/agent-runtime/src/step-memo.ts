// A step's finished result is kept and reused by a retry with the same inputs (2026-10-22). On the Trailhead rerun Arjun's
// planning step hit its time limit while finishing; the finished plan was discarded and the step, including a long call to
// the strongest model, ran again from the start. Results live in <build>/.nexsidi/step-results/<step>-<inputs hash>.json,
// keyed by an exact hash of the inputs, so any change of input (a rejection note, a new spec) runs the step again. Only a
// result the step returned is saved; a step that throws saves nothing. Never creates a build folder that does not exist yet.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export async function memoizeStep<T>(buildDir: string, step: string, inputs: unknown, run: () => Promise<T>): Promise<T> {
  const key = createHash("sha256").update(canonical(inputs)).digest("hex").slice(0, 16);
  const dir = join(buildDir, ".nexsidi", "step-results");
  const file = join(dir, `${step}-${key}.json`);
  try {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf-8")) as { at: string; result: T };
      console.log(`[step-memo] ${step}: reusing the result saved at ${saved.at} (same inputs), not running it again`);
      return saved.result;
    }
  } catch (err) {
    console.warn(`[step-memo] ${step}: saved result unreadable, running the step: ${String(err).slice(0, 120)}`);
  }
  const result = await run();
  try {
    if (existsSync(buildDir)) {
      mkdirSync(dir, { recursive: true });
      // Written whole, then moved into place, so a crash never leaves half a result to reuse.
      writeFileSync(`${file}.tmp`, JSON.stringify({ at: new Date().toISOString(), step, key, result }), "utf-8");
      renameSync(`${file}.tmp`, file);
    }
  } catch (err) {
    console.warn(`[step-memo] ${step}: could not save the result (the step itself succeeded): ${String(err).slice(0, 120)}`);
  }
  return result;
}
