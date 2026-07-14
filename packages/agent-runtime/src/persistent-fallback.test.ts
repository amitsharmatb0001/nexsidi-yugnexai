import { test, expect, mock } from "bun:test";
import { runAgent } from "./loop.ts";
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Mock @nexsidi/db to throw database errors
mock.module("@nexsidi/db", () => {
  throw new Error("Postgres database connection timed out!");
});

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
  const projectId = "test-db-fail-proj";
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const localFile = join(buildDir, projectId, "history-shubham.json");
  const sandboxDir = join(buildDir, projectId, "sandbox");

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
      model: "mock-model",
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
    try {
      unlinkSync(localFile);
    } catch {}
    try {
      rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  }
});
