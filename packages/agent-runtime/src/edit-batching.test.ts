import { test, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execEditFiles, FILE_TOOL_DEFS } from "./tools/file.ts";
import { READONLY_BLOCKED_TOOLS } from "./loop.ts";

// 2026-10-24 (Brewline resume, fix round): the frontend builder made 9 edits in 9 model calls — reads were batched, edits
// were not — and every call resends the whole conversation. edit_files applies many edits, across files, in one call;
// each edit stands alone (one that does not match is reported and the rest still apply).

const real = await import("@nexsidi/llm-client");
const realRoute = real.routeToolsWithFallback;
let active = false;
let script: { name: string; input: Record<string, unknown> }[][] = [];
let n = 0;
let sent: string[] = [];
mock.module("@nexsidi/llm-client", () => ({
  ...real,
  routeToolsWithFallback: async (...args: Parameters<typeof real.routeToolsWithFallback>) => {
    if (!active) return realRoute(...args);
    n++;
    sent.push(JSON.stringify(args[1]));
    const toolCalls = (script.shift() ?? [{ name: "task_complete", input: { summary: "done", files_written: [], verification_passed: true } }])
      .map((c, i) => ({ id: `e${n}-${i}`, ...c }));
    return { content: "", toolCalls, stopReason: "STOP", modelUsed: "fake-model", promptTokens: 10, completionTokens: 5, rawParts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.input } })) };
  },
}));
const { runAgentWithGemini } = await import("./gemini-loop.ts");
afterAll(() => {
  active = false;
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "eb-"));
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "app", "a.tsx"), "const color = 'red';\nconst size = 1;\n");
  writeFileSync(join(dir, "app", "b.tsx"), "export const title = 'Old';\n");
  return dir;
}

test("edit_files applies several edits across files in one call; a non-matching edit is reported, the rest apply", () => {
  const dir = project();
  try {
    const r = execEditFiles(dir, { edits: [
      { path: "app/a.tsx", old_str: "'red'", new_str: "'navy'" },
      { path: "app/a.tsx", old_str: "size = 1", new_str: "size = 2" },
      { path: "app/b.tsx", old_str: "'Old'", new_str: "'New'" },
      { path: "app/b.tsx", old_str: "not there", new_str: "x" },
    ] });
    expect(r.status).toBe("success");
    expect(r.summary).toContain("3 of 4");
    expect(String(r.output)).toContain("not there");
    expect(readFileSync(join(dir, "app", "a.tsx"), "utf-8")).toBe("const color = 'navy';\nconst size = 2;\n");
    expect(readFileSync(join(dir, "app", "b.tsx"), "utf-8")).toBe("export const title = 'New';\n");
    expect((r as { paths?: string[] }).paths?.sort()).toEqual(["app/a.tsx", "app/b.tsx"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edit_files is offered, counts as a write, and is blocked for read-only agents", () => {
  expect(FILE_TOOL_DEFS.some((t) => t.function.name === "edit_files")).toBe(true);
  expect(READONLY_BLOCKED_TOOLS.has("edit_files")).toBe(true);
  const budget = readFileSync(new URL("./step-budget.ts", import.meta.url), "utf-8");
  expect(budget).toMatch(/WRITE_TOOLS = new Set\(\[[^\]]*"edit_files"/);
});

test("the builder loop applies a whole edit_files call in one turn and counts the files as written", async () => {
  const dir = project();
  script = [[{ name: "edit_files", input: { edits: [
    { path: "app/a.tsx", old_str: "'red'", new_str: "'navy'" },
    { path: "app/b.tsx", old_str: "'Old'", new_str: "'New'" },
  ] } }]];
  n = 0;
  sent = [];
  active = true;
  try {
    const result = await runAgentWithGemini({ agentName: "aanya", model: "meta/muse-glimmer-30b", apiKey: "unused", systemPrompt: "s", initialMessage: "Fix.", sandboxDir: dir, maxIterations: 2 });
    // Both edits were applied by the first call: the second call already carries the result for both.
    expect(sent[1]).toContain("Applied 2 of 2 edit(s)");
    expect(readFileSync(join(dir, "app", "a.tsx"), "utf-8")).toContain("'navy'");
    expect(readFileSync(join(dir, "app", "b.tsx"), "utf-8")).toContain("'New'");
    expect(result.filesWritten).toEqual(expect.arrayContaining(["app/a.tsx", "app/b.tsx"]));
  } finally {
    active = false;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every agent loop handles edit_files, and the builders are told to use it", () => {
  for (const file of ["gemini-loop.ts", "loop.ts", "claude-loop.ts"]) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect({ file, ok: src.includes('case "edit_files": {') }).toEqual({ file, ok: true });
  }
  for (const f of ["../skills/aanya/10-workflow-and-verification.md", "../skills/shubham/20-critical-rules-and-verification.md"]) {
    expect({ f, ok: readFileSync(new URL(f, import.meta.url), "utf-8").includes("edit_files") }).toEqual({ f, ok: true });
  }
});
