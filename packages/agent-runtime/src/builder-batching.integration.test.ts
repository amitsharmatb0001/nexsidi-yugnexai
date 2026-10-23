import { test, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 2026-10-23: builder-batching.test.ts checks the pieces; this runs the real builder loop (runAgentWithGemini) end to
// end with only the model replaced, and checks what the model is actually sent: the builder's own files in the first
// message when preloadOwnFiles is set (and not otherwise), and one read_files call returning several files at once.
//
// mock.module is process-global (see persistent-fallback.test.ts), so the fake model is used only while `active` is
// set; every other caller in the same test process gets the real router.
const real = await import("@nexsidi/llm-client");
// Captured before mocking: Bun patches the module's exports in place, so real.routeToolsWithFallback would be the fake.
const realRoute = real.routeToolsWithFallback;
let active = false;
let calls: { messages: unknown[] }[] = [];
let script: { name: string; input: Record<string, unknown> }[][] = [];

mock.module("@nexsidi/llm-client", () => ({
  ...real,
  routeToolsWithFallback: async (...args: Parameters<typeof real.routeToolsWithFallback>) => {
    if (!active) return realRoute(...args);
    calls.push({ messages: structuredClone(args[1]) as unknown[] });
    const toolCalls = (script.shift() ?? [{ name: "task_complete", input: { summary: "done", files_written: [], verification_passed: true } }])
      .map((c, i) => ({ id: `c${calls.length}-${i}`, ...c }));
    return { content: "", toolCalls, stopReason: "STOP", modelUsed: "fake-model", promptTokens: 10, completionTokens: 5, rawParts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.input } })) };
  },
}));

const { runAgentWithGemini } = await import("./gemini-loop.ts");

afterAll(() => {
  active = false;
});

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "bbi-"));
  mkdirSync(join(dir, "app"), { recursive: true });
  mkdirSync(join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(dir, "app", "page.tsx"), "export default function Home() { return <main>BREW-HOME</main>; }\n");
  writeFileSync(join(dir, "lib", "menu.ts"), "export const MENU = ['BREW-LATTE'];\n");
  writeFileSync(join(dir, "node_modules", "dep", "index.js"), "DEPENDENCY-CODE");
  return dir;
}

async function runBuilder(dir: string, preloadOwnFiles: boolean) {
  calls = [];
  active = true;
  try {
    return await runAgentWithGemini({
      agentName: "aanya",
      model: "meta/muse-glimmer-30b",
      apiKey: "unused",
      systemPrompt: "You build the frontend.",
      initialMessage: "Fix the listed findings.",
      sandboxDir: dir,
      maxIterations: 4,
      preloadOwnFiles,
    });
  } finally {
    active = false;
  }
}

// Only what is sent besides the system prompt: the builder skills themselves mention the "YOUR CURRENT FILES" section.
const text = (v: unknown) => JSON.stringify((v as { role?: string }[] | undefined)?.filter((m) => m.role !== "system"));

test("a fix round starts with the builder's own files in the first message, and dependencies are left out", async () => {
  const dir = makeProject();
  try {
    script = [];
    await runBuilder(dir, true);
    const first = text(calls[0]?.messages);
    expect(first).toContain("YOUR CURRENT FILES");
    expect(first).toContain("BREW-HOME");
    expect(first).toContain("BREW-LATTE");
    expect(first).not.toContain("DEPENDENCY-CODE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without the flag (a first phase) nothing is preloaded", async () => {
  const dir = makeProject();
  try {
    script = [];
    await runBuilder(dir, false);
    const first = text(calls[0]?.messages);
    expect(first).not.toContain("YOUR CURRENT FILES");
    expect(first).not.toContain("BREW-HOME");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one read_files call returns several files to the model in a single turn", async () => {
  const dir = makeProject();
  try {
    script = [[{ name: "read_files", input: { paths: ["app/page.tsx", "lib/menu.ts", "missing.ts"] } }]];
    await runBuilder(dir, false);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const second = text(calls[1]?.messages);
    expect(second).toContain("Read 2 of 3 file(s)");
    expect(second).toContain("BREW-HOME");
    expect(second).toContain("BREW-LATTE");
    expect(second).toContain("missing.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
