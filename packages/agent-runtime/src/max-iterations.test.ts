// P5.W5.5 (full agentic upgrade plan): "Lower MAX_ITERATIONS to a realistic
// cap now that the loop converges — a high cap only hides thrash." The
// shared MAX_ITERATIONS=40 constant is used by every agent (Shubham, Aanya,
// Pranav, Saanvi, Arjun, Vanya, Riya, Tilotma's live-eval, QA...) — some of
// those (Riya's deploy+verify, Tier-3 browser review across many pages)
// legitimately need more room than a generation agent that now writes its
// whole plan up front (P5.W5.1) and verifies once. Rather than lowering the
// shared constant (which would false-cap agents that need the room), this
// adds a per-run override so callers who know they now converge fast can opt
// into a realistic cap without affecting anyone else's ceiling.
import { test, expect, mock } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let callCount = 0;
mock.module("@nexsidi/llm-client", () => ({
  nimChatWithTools: async () => {
    callCount++;
    // Vary the tool call every turn (different file path) so
    // detectStuckLoop's identical-3-turns-in-a-row check never fires —
    // this test wants to prove the maxIterations CAP is what stops the
    // loop, not the stuck-loop early exit.
    return {
      id: `m${callCount}`,
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: `c${callCount}`,
                type: "function",
                function: { name: "read_file", arguments: JSON.stringify({ path: `f${callCount}.txt` }) },
              },
            ],
          },
        },
      ],
    };
  },
}));

import { runAgent } from "./loop.ts";

test("config.maxIterations overrides the default MAX_ITERATIONS cap for this run", async () => {
  callCount = 0;
  const dir = join(tmpdir(), `nexsidi-maxiter-test-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 6; i++) writeFileSync(join(dir, `f${i}.txt`), "x");

  // runAgent's SharedTokenBucket persists request counts to a file under
  // BUILD_DIR, shared across every test process on this machine — pointing
  // it at a fresh temp dir gives this test its own untouched 40 req/min
  // window instead of inheriting whatever the rest of the suite already
  // consumed today (same isolation persistent-fallback.test.ts already uses).
  const previousBuildDir = process.env.BUILD_DIR;
  process.env.BUILD_DIR = mkdtempSync(join(tmpdir(), "nexsidi-maxiter-bucket-"));
  try {
    const result = await runAgent({
      agentName: "test-agent",
      // 2026-08-09: "google/" prefix required — sanitizeModelChain now gets
      // a fail-fast empty-chain guard (real bug found live: Riya's own
      // config sanitized to empty and silently fell through to the
      // disallowed model anyway). A bare "mock-model" has no allowed
      // provider prefix and would be dropped before ever reaching the
      // mocked nimChatWithTools below — not a real model to add to ModelId.
      model: "google/mock-model" as any,
      apiKey: "x",
      systemPrompt: "test",
      initialMessage: "test",
      sandboxDir: dir,
      maxIterations: 3,
    });

    expect(result.iterations).toBe(3);
    expect(result.success).toBe(false);
    expect(result.summary).toContain("Max iterations (3)");
  } finally {
    if (previousBuildDir === undefined) delete process.env.BUILD_DIR;
    else process.env.BUILD_DIR = previousBuildDir;
  }
});
