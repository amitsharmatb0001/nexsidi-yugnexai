// Training rounds for the checkers (patent claim 4).
//
//   bun scripts/train-checkers.ts                              # the built-in static checker, free, on real generated apps
//   bun scripts/train-checkers.ts --rounds 10 --count 12 --apps 8
//   bun scripts/train-checkers.ts --dry                        # run the rounds but do not write to the database
//   bun scripts/train-checkers.ts --checker karan --allow-model-spend   # a review agent: SPENDS MODEL MONEY
//
// Each round plants known defects, one per file, in COPIES of real generated code (nothing on disk is changed), runs the
// checker on the changed copies and on the originals, and records what it caught and missed. Missed defects are kept in the
// adversarial example database and are added to that reviewer's prompt at its next review. The curriculum starts at level 1
// (obvious) and moves up or down by the catch rate.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runTrainingRound, recordRound, memoryStore, type Checker, type ExampleStore, type TrainingFile } from "../packages/agent-runtime/src/training/trainer.ts";
import { nextLevel } from "../packages/agent-runtime/src/training/curriculum.ts";
import { staticChecker } from "../packages/agent-runtime/src/training/static-checker.ts";
import type { Level } from "../packages/agent-runtime/src/training/mutations.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(name);

function walk(dir: string, rel = ""): string[] {
  return readdirSync(join(dir, rel)).flatMap((n) => {
    const path = rel ? `${rel}/${n}` : n;
    if (["node_modules", ".next", ".git", "dist", ".nexsidi", "vendor", "components"].includes(n)) return [];
    return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path];
  });
}

/** Real generated server files from the project folders, as the training set. */
function loadFiles(root: string, apps: number, maxFiles: number): TrainingFile[] {
  const out: TrainingFile[] = [];
  const dirs = readdirSync(root).filter((d) => existsSync(join(root, d, "backend", "src"))).slice(0, apps);
  for (const d of dirs) {
    for (const rel of walk(join(root, d))) {
      if (/^backend\/src\/.*\.ts$/.test(rel) && !/\.test\./.test(rel)) out.push({ path: `${d}/${rel}`, source: readFileSync(join(root, d, rel), "utf8") });
    }
  }
  return out.slice(0, maxFiles);
}

/** A review agent as a checker: the files are handed over as one block of code, as the pipeline does. This spends model money. */
async function modelChecker(name: string): Promise<Checker> {
  const mod = await import(`../agents/qa/${name}/src/index.ts`);
  return async (files) => {
    const code = files.map((f) => `### ${f.path}\n${f.source}`).join("\n\n");
    const result = await mod.run("training", 0, code);
    return (result.findings as Array<{ file?: string; line?: number; description?: string; detail?: string }>).map((f) => ({ file: f.file ?? "", line: f.line, issue: f.description ?? f.detail ?? "" }));
  };
}

async function main() {
  const name = arg("--checker") ?? "static";
  if (name !== "static" && !flag("--allow-model-spend")) {
    console.error(`Stopped: "${name}" is a model-backed reviewer, so every round spends money. Add --allow-model-spend to go ahead.`);
    process.exit(1);
  }
  const rounds = Number(arg("--rounds") ?? 6);
  const count = Number(arg("--count") ?? (name === "static" ? 12 : 4));
  const apps = Number(arg("--apps") ?? 8);
  const root = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const files = loadFiles(root, apps, name === "static" ? 400 : count * 3);
  if (files.length === 0) {
    console.error(`Stopped: no generated backend files found under ${root}.`);
    process.exit(1);
  }
  const checker = name === "static" ? staticChecker : await modelChecker(name);

  let store: ExampleStore;
  if (flag("--dry")) store = memoryStore();
  else store = (await import("../packages/db/src/index.ts")).createTrainingStore() as unknown as ExampleStore;

  const history = await store.history(name);
  let level = (history.length ? nextLevel(history[history.length - 1]!.level, history).level : 1) as Level;
  console.log(`Checker: ${name}. Training set: ${files.length} real files. Starting at level ${level} (${history.length} earlier round(s)).${flag("--dry") ? " DRY RUN: nothing is written." : ""}`);
  // The checker's findings on the unchanged files are the same every round, so they are asked for once (it matters when each call costs money).
  const baseline = await checker(files);
  for (let i = 0; i < rounds; i++) {
    const res = await runTrainingRound({ checker, checkerName: name, files, level, count, seed: `${Date.now()}-${i}`, baseline });
    await recordRound(store, res);
    const next = nextLevel(level, await store.history(name));
    const missedKinds = [...new Set(res.missed.map((d) => d.operator))].join(", ") || "none";
    console.log(`round ${i + 1}: level ${level}  planted ${res.planted.length}  caught ${res.caught.length} (${Math.round(res.catchRate * 100)}%)  missed kinds: ${missedKinds}  -> ${next.reason}`);
    if (res.note) console.log(`  note: ${res.note}`);
    level = next.level;
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(`Failed: ${String(err instanceof Error ? err.message : err)}`);
  process.exit(1);
});
