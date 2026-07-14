import { test, expect, mock } from "bun:test";
import { runAgent } from "./loop.ts";
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

let parentTurn = 0;
let subagentTurn = 0;

// Mock @nexsidi/llm-client
mock.module("@nexsidi/llm-client", () => {
  return {
    nimChatWithTools: async (model: string, messages: any[]) => {
      const systemPrompt = messages.find((m) => m.role === "system")?.content || "";
      if (systemPrompt.includes("specialized subagent")) {
        subagentTurn++;
        if (subagentTurn === 1) {
          return {
            id: "sub-m1",
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "sub-c0",
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
          id: "sub-m2",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "sub-c1",
                    type: "function",
                    function: {
                      name: "task_complete",
                      arguments: JSON.stringify({
                        summary: "subagent-work-done",
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
      } else {
        parentTurn++;
        if (parentTurn === 1) {
          return {
            id: "parent-m1",
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "parent-c1",
                      type: "function",
                      function: {
                        name: "spawn_subagent",
                        arguments: JSON.stringify({
                          subtask: "do research",
                          agentName: "researcher",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          };
        }
        if (parentTurn === 2) {
          return {
            id: "parent-m2",
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "parent-c2",
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
          id: "parent-m3",
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "parent-c3",
                    type: "function",
                    function: {
                      name: "task_complete",
                      arguments: JSON.stringify({
                        summary: "parent-work-done",
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
      }
    },
  };
});

test("dynamic subagent spawning and execution", async () => {
  parentTurn = 0;
  subagentTurn = 0;

  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const sandboxDir = join(buildDir, "test-subagent-proj", "sandbox");
  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(join(sandboxDir, "a.txt"), "some test code", "utf-8");

  try {
    const result = await runAgent({
      agentName: "parent-agent",
      model: "google/gemini-3.5-flash",
      apiKey: "key",
      systemPrompt: "prompt",
      initialMessage: "start",
      sandboxDir,
      projectId: "test-subagent-proj",
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe("parent-work-done");
    expect(parentTurn).toBe(3);
    expect(subagentTurn).toBe(2);
  } finally {
    try {
      rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  }
});
