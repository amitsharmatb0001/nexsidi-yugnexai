import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frontendExitChecks } from "./builder-exit-checks.ts";

// 2026-10-24 (Brewline root cause): 8 emoji findings and the missing-colour findings were raised in review, after the
// frontend builder had said "done" — its instructions said "no emoji", and the checks existed, but they only ran later.
// Now the same checks run, by the system, when the builder says it is done (last phase and fix rounds); what they find
// is handed back to the builder first. No model call.

const prevBuildDir = process.env.BUILD_DIR;
let root = "";
afterEach(() => {
  if (prevBuildDir === undefined) delete process.env.BUILD_DIR;
  else process.env.BUILD_DIR = prevBuildDir;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function project(id: string, files: Record<string, string>, description: string): void {
  root = mkdtempSync(join(tmpdir(), "exit-checks-"));
  process.env.BUILD_DIR = root;
  const dir = join(root, id);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ description }));
}

const SPEC = "A coffee shop. Visual direction: soft oat cream #FAF6F0 backgrounds, espresso brown #2C1E18 typography, terracotta #D46A4E accents.";

test("emoji, a dead button and a spec colour missing from the theme are all reported before the builder may finish", () => {
  project("e1", {
    "frontend/app/menu/page.tsx": 'export default function M() { return <div><span>☕</span><button>Order</button></div>; }\n',
    "frontend/app/theme-overrides.css": ":root { --bg: #FAF6F0; --text: #2C1E18; }\n",
  }, SPEC);
  const out = frontendExitChecks("e1");
  expect(out.some((f) => f.includes("emoji"))).toBe(true);
  expect(out.some((f) => f.includes("dead UI"))).toBe(true);
  expect(out.some((f) => f.includes("#D46A4E"))).toBe(true);
  expect(out.some((f) => f.includes("#FAF6F0"))).toBe(false);
});

test("a clean frontend passes, and a spec without colours checks no colours", () => {
  project("e2", {
    "frontend/app/menu/page.tsx": 'export default function M() { return <button onClick={() => {}}>Order</button>; }\n',
    "frontend/app/theme-overrides.css": ":root { --bg: #faf6f0; --text: #2c1e18; --accent: #d46a4e; }\n",
  }, SPEC);
  expect(frontendExitChecks("e2")).toEqual([]);
  project("e3", { "frontend/app/page.tsx": "export default function P() { return null; }\n" }, "A plain site with no colours named.");
  expect(frontendExitChecks("e3")).toEqual([]);
});

test("the frontend builder runs these checks when it says it is done, in its last phase and in fix rounds", () => {
  const src = readFileSync(new URL("../../../agents/generators/aanya/src/index.ts", import.meta.url), "utf-8");
  expect((src.match(/exitChecks:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  for (const file of ["loop.ts", "gemini-loop.ts", "claude-loop.ts"]) {
    const loop = readFileSync(new URL(`../../../packages/agent-runtime/src/${file}`, import.meta.url), "utf-8");
    expect({ file, ok: loop.includes("config.exitChecks") }).toEqual({ file, ok: true });
  }
});

test("the backend builder's middle phases need a passing build, not a live check; the last phase keeps the full check", () => {
  const src = readFileSync(new URL("../../../agents/generators/shubham/src/index.ts", import.meta.url), "utf-8");
  expect(src).toContain('requiredEvidenceKinds: phase && !phase.isLast ? [] : ["http_check"]');
  const phases = readFileSync(new URL("../../activities/build-phases.ts", import.meta.url), "utf-8");
  expect(phases).not.toContain("test THIS phase's endpoints against your running API");
});
