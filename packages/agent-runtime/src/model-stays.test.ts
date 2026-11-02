import { test, expect, mock, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 2026-11-02 (Brewline 7): after a rate limit a builder moved to another model, and the next call started from the first model again:
// 82 changes of model, each losing the reuse discount on the whole conversation, cost 3.7M full-price tokens of the run's 9.2M. A
// builder now stays on the model that answered, and tries the first one again only every so often.
const real = await import("@nexsidi/llm-client");
const realRoute = real.routeToolsWithFallback;
let active = false;
const asked: Array<string | undefined> = [];
let answers: string[] = [];
mock.module("@nexsidi/llm-client", () => ({
  ...real,
  routeToolsWithFallback: async (...args: Parameters<typeof real.routeToolsWithFallback>) => {
    if (!active) return realRoute(...args);
    asked.push((args[3] as { preferModel?: string }).preferModel);
    const model = answers.shift() ?? "fallback";
    const done = answers.length === 0;
    const toolCalls = done
      ? [{ id: "d", name: "task_complete", input: { summary: "done", files_written: [], verification_passed: true } }]
      : [{ id: "l" + asked.length, name: "list_files", input: { path: `d${asked.length}` } }];
    return { content: "", toolCalls, stopReason: "STOP", modelUsed: model, promptTokens: 10, completionTokens: 5, rawParts: toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.input } })) };
  },
}));
const { runAgentWithGemini, MODEL_STAYS_FOR_CALLS } = await import("./gemini-loop.ts");
afterAll(() => {
  active = false;
});

test("the loop asks for the model that last answered, and every so often for the first one again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stays-"));
  answers = ["first", ...Array.from({ length: MODEL_STAYS_FOR_CALLS + 1 }, () => "fallback")];
  asked.length = 0;
  active = true;
  try {
    await runAgentWithGemini({ agentName: "aanya", model: "x", apiKey: "x", systemPrompt: "s", initialMessage: "build", sandboxDir: dir, maxIterations: MODEL_STAYS_FOR_CALLS + 5, skipEvidenceGate: true } as never);
    expect(asked[0]).toBeUndefined();
    expect(asked[1]).toBe("first");
    expect(asked[2]).toBe("fallback");
    expect(asked[MODEL_STAYS_FOR_CALLS]).toBe("fallback");
    expect(asked[MODEL_STAYS_FOR_CALLS + 1]).toBeUndefined();
  } finally {
    active = false;
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

test("the router tries the preferred model first, and only one from its pool", async () => {
  const tried: string[] = [];
  const chat = (async (_m: unknown, _t: unknown, o: { model: string }) => {
    tried.push(o.model);
    return { content: "ok", toolCalls: [], stopReason: "STOP" };
  }) as never;
  const pool = real.poolForTier("generation");
  await realRoute("generation", [], [], { preferModel: pool[1] } as never, { chat });
  expect(tried[0]).toBe(pool[1]!);
  tried.length = 0;
  await realRoute("generation", [], [], { preferModel: "not-in-pool" } as never, { chat });
  expect(tried[0]).toBe(pool[0]!);
});
