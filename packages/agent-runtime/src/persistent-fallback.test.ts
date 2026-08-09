import { test, expect, mock } from "bun:test";
import { runAgent } from "./loop.ts";
import type { ModelId } from "@nexsidi/llm-client";
import { writeFileSync, existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Construct the module successfully, then fail at the operation boundary that
// runAgent is expected to recover from. Throwing in the factory poisons Bun's
// shared module loader before runtime fallback can execute.
mock.module("@nexsidi/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            throw new Error("Postgres database connection timed out!");
          },
        }),
      }),
    }),
  },
}));

let turn = 0;

// Mock @nexsidi/llm-client
mock.module("@nexsidi/llm-client", () => {
  return {
    nimChatWithTools: async () => {
      turn++;
      if (turn === 1) {
        return {
          id: "m1",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "c0",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: JSON.stringify({ path: "a.txt" }),
                    },
                  },
                ],
              },
            },
          ],
        };
      }
      return {
        id: "m2",
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: {
                    name: "task_complete",
                    arguments: JSON.stringify({
                      summary: "backup-done",
                      files_written: [],
                      verification_passed: true,
                    }),
                  },
                },
              ],
            },
          },
        ],
      };
    },
  };
});

test("persistent file fallback works when database throws", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "nexsidi-persistent-fallback-test-"));
  const previousBuildDir = process.env.BUILD_DIR;
  process.env.BUILD_DIR = tempRoot;
  const projectId = "test-db-fail-proj";
  const localFile = join(tempRoot, projectId, "history-shubham.json");
  const sandboxDir = join(tempRoot, projectId, "sandbox");

  // Pre-seed local history file
  const preSeedHistory = [
    { role: "system", content: "custom prompt" },
    { role: "user", content: "prior attempt" },
  ];
  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(join(sandboxDir, "a.txt"), "some content", "utf-8");
  writeFileSync(localFile, JSON.stringify(preSeedHistory, null, 2), "utf-8");

  try {
    turn = 0;
    const result = await runAgent({
      agentName: "shubham",
      // 2026-08-09: "google/" prefix required — sanitizeModelChain now gets
      // a fail-fast empty-chain guard (real bug found live: an unprefixed
      // model sanitized to empty and silently fell through to the
      // disallowed value anyway instead of failing). nimChatWithTools is
      // fully mocked above and ignores the model string entirely — this is
      // a placeholder, not a real model to add to ModelId.
      model: "google/mock-model" as ModelId,
      apiKey: "key",
      systemPrompt: "prompt",
      initialMessage: "start",
      sandboxDir,
      projectId,
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe("backup-done");

    expect(existsSync(localFile)).toBe(true);
    const content = JSON.parse(readFileSync(localFile, "utf-8"));
    expect(content.length).toBeGreaterThan(2);
  } finally {
    if (previousBuildDir === undefined) delete process.env.BUILD_DIR;
    else process.env.BUILD_DIR = previousBuildDir;
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
