import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execReadFiles, FILE_TOOL_DEFS } from "./tools/file.ts";
import { buildOwnFilesPreload } from "./builder-preload.ts";

// 2026-10-23 (Brewline test build, counted from the log): the frontend builder made 317 model calls, every one with exactly
// one tool call; 131 of them read ONE file. Builders had no batch-read tool (only the reviewers did), and every call
// resends the whole conversation. Same remedy as the one-pass reviewers: the builder's own files go into its first message
// when they already exist (later phases, fix rounds), a read_files tool reads several at once, and builders are told to
// group independent actions in one reply. Research the same day: other agents keep a stable cached prefix, batch or
// parallelise tool calls, and avoid re-reading whole files (Codex, Aider, Claude Code, Gemini caching guidance).

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bb-"));
  mkdirSync(join(dir, "app"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "app", "page.tsx"), "export default function P() { return null; }\n");
  writeFileSync(join(dir, "package.json"), '{"name":"brew"}\n');
  writeFileSync(join(dir, "node_modules", "x", "index.js"), "skip me");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("read_files reads several files in one call and reports a missing one without failing the rest", () => {
  const r = execReadFiles(dir, { paths: ["app/page.tsx", "package.json", "nope.ts"] });
  expect(r.status).toBe("success");
  const out = String(r.output);
  expect(out).toContain("=== app/page.tsx ===");
  expect(out).toContain("export default function P()");
  expect(out).toContain('"name":"brew"');
  expect(out).toContain("nope.ts");
  expect(FILE_TOOL_DEFS.some((t) => t.function.name === "read_files")).toBe(true);
});

test("the builder's own files are preloaded whole, skipping dependencies, within a budget", () => {
  const p = buildOwnFilesPreload(dir, 100_000);
  expect(p.included.sort()).toEqual(["app/page.tsx", "package.json"]);
  expect(p.text).toContain("=== FILE: app/page.tsx ===");
  expect(p.text).not.toContain("skip me");
  const small = buildOwnFilesPreload(dir, 80);
  expect(small.omitted.length).toBeGreaterThan(0);
});

test("the builder loop handles read_files, preloads when asked, and builders use it for later phases and fixes", () => {
  const loop = readFileSync(new URL("./gemini-loop.ts", import.meta.url), "utf-8");
  expect(loop).toContain('case "read_files": {');
  expect(loop).toContain("config.preloadOwnFiles");
  for (const agent of ["shubham", "aanya"]) {
    const src = readFileSync(new URL(`../../../agents/generators/${agent}/src/index.ts`, import.meta.url), "utf-8");
    expect({ agent, ok: (src.match(/preloadOwnFiles:/g) ?? []).length >= 2 }).toEqual({ agent, ok: true });
  }
});

test("builders are told to group independent actions", () => {
  for (const f of ["../skills/aanya/10-workflow-and-verification.md", "../skills/shubham/20-critical-rules-and-verification.md"]) {
    const s = readFileSync(new URL(f, import.meta.url), "utf-8");
    expect({ f, ok: s.includes("GROUP INDEPENDENT ACTIONS") }).toEqual({ f, ok: true });
  }
});
