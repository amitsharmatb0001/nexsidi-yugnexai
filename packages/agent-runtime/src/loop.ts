// Real agentic loop using NIM tool calling.
// Replaces the one-shot agentChat() + parse pattern.
// Agents run until they call task_complete or hit MAX_ITERATIONS.

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { MCPClient } from "./mcp/client.ts";
import { nimChatWithTools, type NimToolDef, type NimMessage, type NimToolCall } from "@nexsidi/llm-client";
import { execWriteFile, execWriteFiles, execReadFile, execListFiles, execEditFile, execDeleteFile, execRollbackWorkspace, execQuerySymbol, FILE_TOOL_DEFS } from "./tools/file.ts";
import { initWorkspaceTransaction, commitWorkspaceTransaction } from "./tools/git.ts";
import { compactHistory, estimateTokenCount } from "./compaction.ts";
import { SharedTokenBucket } from "./token-bucket.ts";
import { BudgetTracker } from "./budget-tracker.ts";
import { execRunCommand, COMMAND_TOOL_DEF } from "./tools/command.ts";
import { execHttpRequest, HTTP_TOOL_DEF } from "./tools/http.ts";
import { execDockerCompose, DOCKER_TOOL_DEF } from "./tools/docker.ts";
import { execWebSearch, WEB_SEARCH_TOOL_DEF } from "./tools/websearch.ts";
import { execFetchUrl, FETCH_URL_TOOL_DEF } from "./tools/research.ts";
import { recordEscalation, ESCALATE_FINDING_TOOL_DEF, type Escalation } from "./tools/escalate.ts";
import { execScreenshot, SCREENSHOT_TOOL_DEF } from "./tools/screenshot.ts";
import { BrowserToolset, BROWSER_TOOL_DEFS, BROWSER_TOOL_NAMES } from "./tools/browser.ts";
import { execDbQuery, DB_QUERY_TOOL_DEF } from "./tools/db.ts";
import { createEvidenceLedger, type EvidenceKind } from "./enforce/evidence.ts";
import { checkCompletion } from "./enforce/completion-gate.ts";
import { createStrikeCounter, buildFailureSignature, type StrikeCounter } from "./enforce/strikes.ts";
import { detectStuckLoop } from "./enforce/stuck-loop.ts";
import { assembleSystemPrompt } from "./prompt-assembly.ts";
import type { ToolResult } from "./tools/file.ts";
import type { ModelId } from "@nexsidi/llm-client";

// Exported so claude-loop.ts's runAgentWithClaude() can reuse the exact same
// iteration cap instead of redefining it (per Task 15 spec — "same
// MAX_ITERATIONS constant, import it, don't redefine").
export const MAX_ITERATIONS = 40;

export interface AgentRunConfig {
  agentName: string;
  model: ModelId;
  // Optional additional NIM models tried, in order, if `model` fails or its
  // circuit breaker opens — added after stress-test 1 (F7) found the loop had
  // no recovery besides retrying the same broken model until MAX_ITERATIONS,
  // then falling all the way through to Task 15's Claude escalation. Each
  // model in the chain is tried once; once the chain is exhausted, falls back
  // to the original sleep-and-retry-the-last-model behavior. This sits BELOW
  // runAgentEscalated's Claude escalation (packages/agent-runtime/src/claude-
  // loop.ts) — still open-source only, tried before ever reaching for Sonnet 5.
  fallbackModels?: ModelId[];
  apiKey: string;
  systemPrompt: string;
  initialMessage: string;
  sandboxDir: string;         // all file ops scoped here
  projectId?: string;          // optional, for database history persistence
  enableDockerTools?: boolean; // Riya only
  enableHttpTools?: boolean;   // Shubham verification
  enableWebSearch?: boolean;   // fact-checking / package verification
  // Phase 5 (full agentic upgrade): reading ONE specific known page (a
  // user-referenced company site, a design reference) — complements
  // enableWebSearch, which answers open questions via Gemini grounding
  // rather than extracting one exact URL's full content.
  enableWebFetch?: boolean;
  // P3 (agent-autonomy-assessment F3): lets a fix agent hand a finding off
  // to the agent that actually owns the layer where the fix belongs,
  // instead of forcing a workaround in its own domain. See tools/escalate.ts.
  enableEscalation?: boolean;
  enableScreenshot?: boolean;  // visual QA
  enableBrowser?: boolean;     // interactive live-app QA (navigate/click/fill/console-errors/computed-style) — Tilotma Tier 3
  enableDbQuery?: boolean;     // read-only DB verification (data-round-trip checks) — Tilotma Tier 3
  // 2026-07-12: per-role Gemini model. Generators set this to the pro thinking
  // model (code quality); high-volume tool-driving agents (Tier 3, QA) leave
  // it unset to use the cheap flash default. Only used by the Gemini loop.
  geminiModel?: string;
  // When set, task_complete is mechanically rejected until every listed
  // command has exited 0 during this exact run. Unrelated successful tools
  // such as `node -v` cannot satisfy a generator's compile gate.
  requiredVerificationCommands?: string[];
  // 2026-07-25 (P5.W5.4): kind-level equivalent of the above, for agents
  // whose real proof-of-work isn't a shell command — Riya's deploy
  // verification is docker_compose/http_request tool calls, which
  // requiredVerificationCommands (exact command-string matching) can't
  // express at all. See EvidenceLedger.hasEvidenceOfKind.
  requiredEvidenceKinds?: EvidenceKind[];
  // 2026-08-06: see completion-gate.ts's checkCompletion comment — lets an
  // EVALUATOR agent (Tilotma's reality-checker) honestly report
  // verification_passed=false as a complete, terminal "I checked and found
  // real bugs" finding, instead of the gate coercing it into a false
  // positive. Default false preserves the existing must-be-true behavior
  // for every generator agent (Shubham/Aanya/Pranav/Riya).
  allowFailedVerification?: boolean;
  subagentDepth?: number; // 0 = top-level agent; 1 = inside a spawn_subagent call. Capped at 1.
  // 2026-07-25 (P5.W5.5): per-run override of MAX_ITERATIONS. The shared
  // constant stays a generous ceiling for agents that legitimately need it
  // (Riya's deploy+verify, Tilotma's live-eval navigating many pages); a
  // generator that now writes its whole plan up front (P5.W5.1) and
  // verifies once converges in a handful of turns, so a high shared cap
  // only hides thrash for it. Unset = MAX_ITERATIONS (unchanged behavior).
  maxIterations?: number;
  // 2026-07-25 (Phase 1, full MVP upgrade): per-agent Gemini tier, ONLY
  // consumed by gemini-loop.ts's runAgentWithGemini (this file's NIM path
  // has its own separate model chain — AGENT_MODELS/FALLBACK_CHAIN — and
  // ignores this field entirely). Typed as a bare string here rather than
  // importing GeminiTier from @nexsidi/llm-client, so this NIM-only file
  // doesn't take a dependency on a type it never uses; gemini-loop.ts casts
  // it back to GeminiTier. Verified live (audit-2026-07-25.md, A.3) that
  // every Gemini-loop agent previously hardcoded "generation" regardless of
  // role — Aanya (frontend/design, 0.70 of the subjective score) got the
  // same tier as Shubham (backend boilerplate). Unset = "generation"
  // (unchanged behavior).
  geminiTier?: string;
}

export interface AgentRunResult {
  success: boolean;
  summary: string;
  filesWritten: string[];
  iterations: number;
  errors: string[];
  // Phase 5 Task 4: populated on every success:false exit so
  // runAgentEscalated (claude-loop.ts) can log WHY it's escalating, not just
  // that it is. "three_strikes" = the same command failed identically 4
  // times; "cannot_finish" = any other non-success exit (max iterations,
  // agent stopped without task_complete, transport failures).
  escalationReason?: "three_strikes" | "cannot_finish";
  // P3 (agent-autonomy-assessment F3): findings this run handed off to
  // another agent's domain via escalate_finding — see tools/escalate.ts.
  // Optional (matches escalationReason's convention above) — absent means
  // "this run never called escalate_finding" (its enableEscalation was off,
  // or it never had a reason to escalate), not "empty on purpose". Callers
  // that care read `result.escalations ?? []`.
  escalations?: Escalation[];
}

// Exported for the same reason as MAX_ITERATIONS above — claude-loop.ts
// reuses this exact contract (translated to Claude's tool format) instead of
// redefining it.
export const TASK_COMPLETE_TOOL: NimToolDef = {
  type: "function",
  function: {
    name: "task_complete",
    description: "Call this when your task is fully done. All files written, all verification passed. Do NOT call this until you have verified the output works (tsc passes, build succeeds, or health check passes).",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What you built and what verification you ran" },
        files_written: { type: "array", items: { type: "string" }, description: "List of all file paths written" },
        verification_passed: { type: "boolean", description: "True only if tsc/build/health-check actually passed" },
      },
      required: ["summary", "files_written", "verification_passed"],
    },
  },
};

export const SPAWN_SUBAGENT_TOOL: NimToolDef = {
  type: "function",
  function: {
    name: "spawn_subagent",
    description: "Spawn a specialized subagent to perform a delegated subtask in the background (such as executing research, validating code segments, or running isolated test cases). This saves token budget and avoids context bloat.",
    parameters: {
      type: "object",
      properties: {
        subtask: { type: "string", description: "The clear instruction or task description for the subagent to achieve." },
        agentName: { type: "string", description: "A specific name/role for the subagent, e.g. 'researcher' or 'tester'." }
      },
      required: ["subtask", "agentName"]
    }
  }
};

// Full-system audit T1/L1: replaces any tool_call whose `function.arguments`
// isn't valid JSON with a safe "{}" placeholder, and records which call ids
// were touched. Exists so the CALLER can push only sanitized tool_calls into
// conversation history — never the raw, possibly-truncated-mid-JSON string a
// model produced when it hit the token cap mid-write_file. Pure and
// dependency-free on purpose: directly unit-testable without mocking the
// network (see loop.test.ts).
export function sanitizeToolCalls(toolCalls: NimToolCall[]): { sanitized: NimToolCall[]; malformedIds: Set<string> } {
  const malformedIds = new Set<string>();
  const sanitized = toolCalls.map((call) => {
    try {
      JSON.parse(call.function.arguments);
      return call;
    } catch {
      malformedIds.add(call.id);
      return { ...call, function: { ...call.function, arguments: "{}" } };
    }
  });
  return { sanitized, malformedIds };
}

// Phase 5 Task 4: mechanical 3-strike escalation (Rule 7). Pure and
// dependency-free on purpose, same as sanitizeToolCalls above — the loop
// calls this on every run_command result; a successful result passes
// through untouched. On the 3rd identical failure it injects a forced-pivot
// instruction into next_actions; on the 4th it reports exhausted so the
// caller can terminate the run.
async function diagnoseError(command: string, output: string): Promise<string> {
  const lines = output.split("\n");
  const errorLine = lines.find(l => l.includes("error TS") || l.includes("Error:") || l.includes("Cannot find module") || l.includes("Module not found")) 
    || lines.find(l => l.trim().startsWith("Err"))
    || lines[0] 
    || "";
    
  if (!errorLine.trim()) return "";
  
  try {
    const query = `how to resolve compiler error: ${errorLine.trim().slice(0, 150)}`;
    const searchResult = await execWebSearch({ query, timeout_ms: 10000 });
    if (searchResult.status === "success" && searchResult.output) {
      return `\n\n[DIAGNOSTIC ENGINE SEARCH FINDINGS]\nPossible resolution suggestions from web search:\n${searchResult.output.slice(0, 800)}\n`;
    }
  } catch (err) {
    // fall through
  }
  return "";
}

export async function evaluateCommandStrike(
  counter: StrikeCounter,
  command: string,
  toolResult: ToolResult,
  diagnose: (command: string, output: string) => Promise<string> = diagnoseError,
): Promise<{ toolResult: ToolResult; exhausted: boolean }> {
  if (toolResult.status !== "error") return { toolResult, exhausted: false };

  const signature = buildFailureSignature(command, toolResult.output ?? toolResult.summary);
  const strike = counter.recordFailure(signature);

  if (strike.exhausted) return { toolResult, exhausted: true };

  let diagAdvice = "";
  if (strike.strikes >= 2) {
    diagAdvice = await diagnose(command, toolResult.output ?? toolResult.summary ?? "");
  }

  const nextActions = [...(toolResult.next_actions ?? [])];
  if (strike.strikes === 3) {
    nextActions.push("This approach failed 3 times with the same error. Do not retry it. Change approach fundamentally or call escalate.");
  }
  if (diagAdvice) {
    nextActions.push("Review the DIAGNOSTIC ENGINE SEARCH FINDINGS added to the output to fix this failure.");
  }

  if (!diagAdvice && nextActions.length === 0) {
    return { toolResult, exhausted: false };
  }

  return {
    toolResult: {
      ...toolResult,
      output: (toolResult.output ?? "") + diagAdvice,
      next_actions: nextActions,
    },
    exhausted: false,
  };
}

export function buildToolList(config: AgentRunConfig): NimToolDef[] {
  return [
    ...FILE_TOOL_DEFS,
    COMMAND_TOOL_DEF,
    ...(config.enableHttpTools ? [HTTP_TOOL_DEF] : []),
    ...(config.enableDockerTools ? [DOCKER_TOOL_DEF] : []),
    ...(config.enableWebSearch ? [WEB_SEARCH_TOOL_DEF] : []),
    ...(config.enableWebFetch ? [FETCH_URL_TOOL_DEF] : []),
    ...(config.enableEscalation ? [ESCALATE_FINDING_TOOL_DEF] : []),
    ...(config.enableScreenshot ? [SCREENSHOT_TOOL_DEF] : []),
    ...(config.enableBrowser ? BROWSER_TOOL_DEFS : []),
    ...(config.enableDbQuery ? [DB_QUERY_TOOL_DEF] : []),
    TASK_COMPLETE_TOOL,
    SPAWN_SUBAGENT_TOOL,
  ];
}

export function sanitizeModelChain(models: string[]): string[] {
  const allowedPrefixes = ["google/", "mistralai/", "meta/", "qwen/", "nvidia/"];
  const allowedExact = ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash"];

  return models
    .map((m) => {
      if (m.startsWith("anthropic/") || m.includes("claude") || m.includes("vertex")) {
        console.warn(`[model-routing] Replacing disallowed model "${m}" with "google/gemini-3.5-flash"`);
        return "google/gemini-3.5-flash";
      }
      return m;
    })
    .filter((m) => {
      const lower = m.toLowerCase();
      const isAllowed =
        allowedPrefixes.some((prefix) => lower.startsWith(prefix)) ||
        allowedExact.some((exact) => lower.includes(exact));
      if (!isAllowed) {
        console.warn(`[model-routing] Dropping disallowed model "${m}"`);
      }
      return isAllowed;
    });
}

export async function runAgent(config: AgentRunConfig): Promise<AgentRunResult> {
  const originalLog = console.log;
  const originalError = console.error;
  // emitEvent: writes a structured JSON event to events.jsonl so the UI can
  // render rich tool-call cards (file edits, commands, web searches, etc.)
  // alongside the raw log text — same pattern as Claude Code's sidebar.
  const emitEvent = (event: Record<string, unknown>) => {
    if (!config.projectId) return;
    try {
      const logDir = join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", config.projectId!, "logs");
      const { mkdirSync, appendFileSync } = require("fs");
      mkdirSync(logDir, { recursive: true });
      appendFileSync(
        join(logDir, "events.jsonl"),
        JSON.stringify({ ts: Date.now(), agent: config.agentName, ...event }) + "\n",
        "utf-8",
      );
    } catch {}
  };

  if (config.projectId) {
    const logToFile = (msg: string) => {
      try {
        const logDir = join(process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds", config.projectId!, "logs");
        const { mkdirSync, appendFileSync } = require("fs");
        mkdirSync(logDir, { recursive: true });
        appendFileSync(join(logDir, "pipeline.log"), `${new Date().toISOString()} [${config.agentName}] ${msg}\n`, "utf-8");
      } catch {}
    };
    console.log = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
      logToFile(msg);
      originalLog(...args);
    };
    console.error = (...args: any[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
      logToFile(`[ERROR] ${msg}`);
      originalError(...args);
    };
  }

  const tools: NimToolDef[] = buildToolList(config);

  const mcpClients: MCPClient[] = [];
  const mcpToolsMap = new Map<string, MCPClient>();
  try {
    const mcpConfigPath = join(process.cwd(), "mcp-config.json");
    if (existsSync(mcpConfigPath)) {
      const configData = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
      if (configData.mcpServers) {
        for (const [name, serverDef] of Object.entries(configData.mcpServers) as [string, any][]) {
          console.log(`[mcp] Spawning MCP Server "${name}": ${serverDef.command} ${serverDef.args.join(" ")}`);
          const client = new MCPClient(serverDef.command, serverDef.args, serverDef.env);
          await client.start();
          mcpClients.push(client);

          const toolsResult = await client.listTools();
          for (const mcpTool of toolsResult.tools) {
            tools.push({
              type: "function",
              function: {
                name: mcpTool.name,
                description: mcpTool.description,
                parameters: mcpTool.inputSchema as any,
              },
            });
            mcpToolsMap.set(mcpTool.name, client);
          }
        }
      }
    }
  } catch (err) {
    console.error("[mcp] Failed to load/initialize MCP tools:", err);
  }

  if (config.sandboxDir) {
    initWorkspaceTransaction(config.sandboxDir);
  }

  // Phase 5 Task 3: per-run ledger backing the completion gate — see
  // enforce/evidence.ts and enforce/completion-gate.ts.
  const ledger = createEvidenceLedger();

  // Phase 5 Task 6: skills injected at runtime — core-reasoning doctrine +
  // this agent's own doctrine (if any) layered ahead of its basePrompt.
  const systemPrompt = assembleSystemPrompt({ agentName: config.agentName, basePrompt: config.systemPrompt });

  let messages: NimMessage[] = [];
  let loadedFromDb = false;

  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const localHistoryPath = config.projectId
    ? join(buildDir, config.projectId, `history-${config.agentName}.json`)
    : null;

  if (config.projectId) {
    try {
      const { db } = await import("@nexsidi/db");
      const { agentConversations } = await import("@nexsidi/db/schema");
      const { eq, and } = await import("drizzle-orm");

      const existing = await db
        .select()
        .from(agentConversations)
        .where(
          and(
            eq(agentConversations.projectId, config.projectId),
            eq(agentConversations.agentName, config.agentName)
          )
        )
        .limit(1);

      if (existing[0]) {
        messages = existing[0].messages as NimMessage[];
        const sysIdx = messages.findIndex((m) => m.role === "system");
        if (sysIdx >= 0) {
          messages[sysIdx] = { role: "system", content: systemPrompt };
        }
        messages.push({ role: "user", content: config.initialMessage });
        loadedFromDb = true;
        console.log(`[${config.agentName}:agent] Loaded existing conversation history (${messages.length} messages) from database`);
      }
    } catch (e) {
      console.error(`[${config.agentName}:agent] Failed to load history from DB, falling back to local file:`, e);
      if (localHistoryPath && existsSync(localHistoryPath)) {
        try {
          messages = JSON.parse(readFileSync(localHistoryPath, "utf-8"));
          const sysIdx = messages.findIndex((m) => m.role === "system");
          if (sysIdx >= 0) {
            messages[sysIdx] = { role: "system", content: systemPrompt };
          }
          messages.push({ role: "user", content: config.initialMessage });
          loadedFromDb = true;
          console.log(`[${config.agentName}:agent] Loaded existing conversation history (${messages.length} messages) from local backup file`);
        } catch (fileErr) {
          console.error(`[${config.agentName}:agent] Failed to load history from local backup file:`, fileErr);
        }
      }
    }
  }

  if (!loadedFromDb) {
    messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: config.initialMessage },
    ];
  }

  const saveHistory = async () => {
    // Proactively save to local file backup
    if (localHistoryPath) {
      try {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(dirname(localHistoryPath), { recursive: true });
        writeFileSync(localHistoryPath, JSON.stringify(messages, null, 2), "utf-8");
        console.log(`[${config.agentName}:agent] Saved conversation history backup to local file`);
      } catch (fileErr) {
        console.error(`[${config.agentName}:agent] Failed to save history backup to local file:`, fileErr);
      }
    }

    if (config.projectId) {
      try {
        const { db } = await import("@nexsidi/db");
        const { agentConversations } = await import("@nexsidi/db/schema");
        const { eq, and } = await import("drizzle-orm");

        const existing = await db
          .select()
          .from(agentConversations)
          .where(
            and(
              eq(agentConversations.projectId, config.projectId),
              eq(agentConversations.agentName, config.agentName)
            )
          )
          .limit(1);

        if (existing[0]) {
          await db
            .update(agentConversations)
            .set({
              messages,
              updatedAt: new Date(),
            })
            .where(eq(agentConversations.id, existing[0].id));
        } else {
          await db.insert(agentConversations).values({
            projectId: config.projectId,
            agentName: config.agentName,
            messages,
          });
        }
        console.log(`[${config.agentName}:agent] Saved conversation history (${messages.length} messages) to database`);
      } catch (e) {
        console.error(`[${config.agentName}:agent] Failed to save history to DB:`, e);
      }
    }
  };

  const filesWritten: string[] = [];
  const escalations: Escalation[] = [];
  const errors: string[] = [];
  const effectiveMaxIterations = config.maxIterations ?? MAX_ITERATIONS;
  let iterations = 0;
  // Phase 5 Task 4: mechanical 3-strike escalation — see enforce/strikes.ts.
  const strikeCounter = createStrikeCounter();
  let exhaustedThreeStrikes = false;
  // 2026-07-12: real bug found live — evaluateCommandStrike only fires on a
  // run_command call FAILING identically. It never catches a call that keeps
  // SUCCEEDING without making progress (read_file on the same path,
  // docker_compose logs on the same service) — that grinds silently to
  // MAX_ITERATIONS with no diagnostic. Same detectStuckLoop used in
  // qa-loop.ts (Navya/Karan/Deepika) and gemini-loop.ts, applied here too so
  // the NIM path gets the same early exit.
  const recentCallSignatures: string[] = [];

  const modelChain: ModelId[] = sanitizeModelChain([config.model, ...(config.fallbackModels ?? [])]) as ModelId[];
  let modelIdx = 0;

  // L3 (full-system audit): `iterations` now counts real model turns only.
  // Previously incremented at the TOP of the loop, so every transport
  // failure + sleep(5s) cycle also consumed the main budget — stress-test
  // runs 3/5/7 showed 30+ "iterations" that were pure sleeps with zero
  // model interaction, exhausting MAX_ITERATIONS on network noise rather
  // than actual agent attempts. Transport failures on the LAST model in the
  // chain now get their own small budget and abort early instead.
  const MAX_CONSECUTIVE_TRANSPORT_FAILURES = 5;
  let consecutiveTransportFailures = 0;
  let abortedOnTransportFailures = false;

  console.log(`[${config.agentName}:agent] Starting — model: ${config.model}, maxIter: ${effectiveMaxIterations}` +
    (modelChain.length > 1 ? `, fallbacks: ${modelChain.slice(1).join(", ")}` : ""));

  const budget = new BudgetTracker();
  const bucket = new SharedTokenBucket();

  // Interactive-browser QA session (Tilotma Tier 3). Lazily spawns a Node
  // worker + Chromium on first browser tool call; the `finally` below closes
  // it on every exit path (task_complete, stop, cap, or throw).
  const browserToolset = config.enableBrowser ? new BrowserToolset() : null;
  try {
  while (iterations < effectiveMaxIterations) {
    const currentModel = modelChain[modelIdx] ?? config.model;

    let response;
    try {
      const estimatedTokens = estimateTokenCount(messages);
      await bucket.acquire(estimatedTokens);

      response = await nimChatWithTools(currentModel, messages, tools, config.apiKey);

      const usage = (response as any).usage ?? { prompt_tokens: estimatedTokens, completion_tokens: 300 };
      budget.recordRequest(usage.prompt_tokens, usage.completion_tokens);
    } catch (err) {
      errors.push(`NIM call failed (model: ${currentModel}): ${String(err)}`);
      if (modelIdx < modelChain.length - 1) {
        modelIdx++;
        // Include the actual error — previously only pushed to the errors
        // array (which callers rarely surface), so run logs showed models
        // "falling back" dozens of times with the REASON invisible, making
        // model-failure diagnosis impossible from logs alone.
        console.log(`[${config.agentName}:agent] ${currentModel} failed (${String(err).slice(0, 300)}) — falling back to next model: ${modelChain[modelIdx]}`);
        continue; // no sleep — a different model's circuit breaker is likely still closed
      }
      consecutiveTransportFailures++;
      if (consecutiveTransportFailures >= MAX_CONSECUTIVE_TRANSPORT_FAILURES) {
        errors.push(`Aborting after ${MAX_CONSECUTIVE_TRANSPORT_FAILURES} consecutive transport failures on ${currentModel} — not burning the rest of the iteration budget on network noise`);
        abortedOnTransportFailures = true;
        break;
      }
      // Chain exhausted — same original behavior: sleep and retry the last model
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    consecutiveTransportFailures = 0;
    iterations++;
    console.log(`[${config.agentName}:agent] Iteration ${iterations} (model: ${currentModel})`);

    const choice = response.choices[0];
    if (!choice) {
      errors.push(`Empty response on iteration ${iterations}`);
      break;
    }

    if (choice.message.content) {
      const thinkingMatch = choice.message.content.match(/<thinking>([\s\S]*?)<\/thinking>/);
      if (thinkingMatch?.[1]) {
        console.log(`[${config.agentName}:agent] Thinking:\n${thinkingMatch[1].trim()}`);
      } else {
        console.log(`[${config.agentName}:agent] Response:\n${choice.message.content.trim()}`);
      }
    }

    // T1 fix: sanitize BEFORE pushing to `messages` — an unparseable
    // arguments string that survives into history poisons every subsequent
    // request (NIM re-validates the full array). Previously the raw
    // tool_calls were pushed here and only checked for valid JSON later, at
    // execution time — too late, the damage to history was already done.
    // Confirmed via stress-test run 5: the same parse error replayed at the
    // identical byte offset for 14 consecutive iterations.
    const { sanitized: sanitizedToolCalls, malformedIds } = sanitizeToolCalls(choice.message.tool_calls ?? []);

    const assistantMsg: NimMessage = {
      role: "assistant",
      content: choice.message.content ?? null,
      tool_calls: sanitizedToolCalls.length > 0 ? sanitizedToolCalls : undefined,
    };
    messages.push(assistantMsg);

    // Output was cut off by the token cap — any tool_calls present may be
    // incomplete even after sanitizing. Tell the model directly instead of
    // silently continuing with truncated state (this is what let a model
    // write half a file, get cut off, and then have no way to know why the
    // next turn's history looked wrong).
    if (choice.finish_reason === "length") {
      errors.push(`Output truncated (finish_reason: length) on iteration ${iterations}`);
      const truncationNotice = "Your previous response was cut off — it was too long. Write large files in smaller pieces (split one write_file into several), or shorten your reasoning before tool calls.";
      if (sanitizedToolCalls.length > 0) {
        for (const call of sanitizedToolCalls) {
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ status: "error", summary: truncationNotice }) });
        }
      } else {
        messages.push({ role: "user", content: truncationNotice });
      }
      continue;
    }

    // No tool calls — model is done but didn't call task_complete
    if (sanitizedToolCalls.length === 0) {
      if (choice.finish_reason === "stop") {
        console.log(`[${config.agentName}:agent] Model stopped without task_complete — treating as done`);
        return { success: false, summary: choice.message.content ?? "no content", filesWritten, iterations, errors: [...errors, "Agent stopped without calling task_complete"], escalationReason: "cannot_finish", escalations };
      }
      continue;
    }

    const turnSignature = sanitizedToolCalls.map((c) => `${c.function.name}:${c.function.arguments}`).join("|");
    recentCallSignatures.push(turnSignature);
    if (detectStuckLoop(recentCallSignatures)) {
      const reason = `Stuck: ${config.agentName} repeated the identical tool call (${turnSignature.slice(0, 150)}) 3 turns in a row with no progress — stopped early instead of grinding to the ${effectiveMaxIterations}-iteration cap.`;
      console.log(`[${config.agentName}:agent] ${reason}`);
      await saveHistory();
      return { success: false, summary: reason, filesWritten, iterations, errors: [...errors, reason], escalationReason: "cannot_finish", escalations };
    }

    // Execute all tool calls
    const toolResults: NimMessage[] = [];
    for (const call of sanitizedToolCalls) {
      if (malformedIds.has(call.id)) {
        toolResults.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ status: "error", summary: "Invalid JSON in tool arguments — retry this call with valid JSON" }) });
        continue;
      }

      const toolName = call.function.name;
      // Safe: sanitizeToolCalls guarantees every non-malformed call's
      // arguments already parsed successfully once.
      const args = JSON.parse(call.function.arguments) as Record<string, unknown>;

      console.log(`[${config.agentName}:agent] Tool call: ${toolName}(${JSON.stringify(args).slice(0, 120)})`);

      let result: Record<string, any>;

      switch (toolName) {
        case "write_file": {
          const writeArgs = args as { path: string; content: string };
          emitEvent({ type: "tool_call", tool: "write_file", input: { path: writeArgs.path, bytes: writeArgs.content.length } });
          const r = execWriteFile(config.sandboxDir, writeArgs);
          if (r.status === "success") {
            filesWritten.push(writeArgs.path);
            commitWorkspaceTransaction(config.sandboxDir, `Wrote ${writeArgs.path}`);
            emitEvent({ type: "tool_result", tool: "write_file", status: "success", path: writeArgs.path });
          }
          result = r;
          break;
        }
        // 2026-07-25 (Phase 2.3): batch write — see execWriteFiles's comment
        // in tools/file.ts for the root cause this closes (one-file-per-turn
        // forced by the tool shape, not by any real constraint).
        case "write_files": {
          const writeArgs = args as { files: Array<{ path: string; content: string }> };
          emitEvent({ type: "tool_call", tool: "write_files", input: { count: writeArgs.files?.length ?? 0 } });
          const r = execWriteFiles(config.sandboxDir, writeArgs);
          if (r.status === "success" && Array.isArray(writeArgs.files)) {
            for (const f of writeArgs.files) {
              filesWritten.push(f.path);
            }
            commitWorkspaceTransaction(config.sandboxDir, `Wrote ${writeArgs.files.length} files`);
            emitEvent({ type: "tool_result", tool: "write_files", status: "success", path: writeArgs.files.map((f) => f.path).join(",") });
          }
          result = r;
          break;
        }
        case "read_file": {
          const readArgs = args as { path: string; offset?: number; limit?: number };
          emitEvent({ type: "tool_call", tool: "read_file", input: { path: readArgs.path } });
          result = execReadFile(config.sandboxDir, readArgs, ledger);
          break;
        }
        case "list_files": {
          result = execListFiles(config.sandboxDir, args as { dir?: string; recursive?: boolean });
          break;
        }
        case "edit_file": {
          const editArgs = args as { path: string; old_str: string; new_str: string };
          emitEvent({ type: "tool_call", tool: "edit_file", input: { path: editArgs.path } });
          const r = execEditFile(config.sandboxDir, editArgs);
          if (r.status === "success") {
            commitWorkspaceTransaction(config.sandboxDir, `Edited ${editArgs.path}`);
            emitEvent({ type: "tool_result", tool: "edit_file", status: "success", path: editArgs.path });
          }
          result = r;
          break;
        }
        case "delete_file": {
          const delArgs = args as { path: string };
          emitEvent({ type: "tool_call", tool: "delete_file", input: { path: delArgs.path } });
          const r = execDeleteFile(config.sandboxDir, delArgs);
          if (r.status === "success") {
            commitWorkspaceTransaction(config.sandboxDir, `Deleted ${delArgs.path}`);
          }
          result = r;
          break;
        }
        case "run_command": {
          const commandArgs = args as { command: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "run_command", input: commandArgs });
          const r = execRunCommand(config.sandboxDir, commandArgs, ledger);
          emitEvent({ type: "tool_result", tool: "run_command", status: r.status, summary: r.summary, output: (r.output ?? "").slice(0, 500) });

          // Self-repair harness: when a command fails and web_search is enabled,
          // inject a mandatory search instruction into next_actions so the model
          // is forced to search before retrying instead of blindly re-running.
          if (r.status === "error" && config.enableWebSearch) {
            const errorSnippet = ((r.output ?? "") + " " + (r.summary ?? "")).trim().slice(0, 300);
            emitEvent({ type: "repair", status: "searching", errorSnippet: errorSnippet.slice(0, 150) });
            r.next_actions = [
              `SELF-REPAIR: use web_search immediately with the exact error: "${errorSnippet.slice(0, 150)}" — find the fix, apply it, THEN retry the command.`,
              ...(r.next_actions ?? []),
            ];
          }

          const strike = await evaluateCommandStrike(strikeCounter, commandArgs.command, r);
          result = strike.toolResult;
          if (strike.exhausted) exhaustedThreeStrikes = true;
          break;
        }
        case "http_request": {
          const httpArgs = args as { method: string; url: string; headers?: Record<string, string>; body?: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "http_request", input: { method: httpArgs.method, url: httpArgs.url } });
          result = await execHttpRequest(httpArgs, ledger);
          emitEvent({ type: "tool_result", tool: "http_request", status: result.status, summary: result.summary });
          break;
        }
        case "docker_compose": {
          const dockerArgs = args as { action: "up" | "down" | "logs" | "ps"; service?: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "docker_compose", input: dockerArgs });
          result = await execDockerCompose(config.sandboxDir, dockerArgs);
          emitEvent({ type: "tool_result", tool: "docker_compose", status: result.status, summary: result.summary });
          break;
        }
        case "web_search": {
          const searchArgs = args as { query: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "web_search", input: { query: searchArgs.query } });
          result = await execWebSearch(searchArgs);
          emitEvent({ type: "tool_result", tool: "web_search", status: result.status, summary: result.summary });
          break;
        }
        case "fetch_url": {
          const fetchArgs = args as { url: string; timeout_ms?: number };
          emitEvent({ type: "tool_call", tool: "fetch_url", input: { url: fetchArgs.url } });
          result = await execFetchUrl(fetchArgs);
          emitEvent({ type: "tool_result", tool: "fetch_url", status: result.status, summary: result.summary });
          break;
        }
        case "screenshot": {
          const ssArgs = args as { url: string; outputPath: string };
          emitEvent({ type: "tool_call", tool: "screenshot", input: ssArgs });
          result = await execScreenshot(ssArgs);
          emitEvent({ type: "tool_result", tool: "screenshot", status: result.status, summary: result.summary, outputPath: ssArgs.outputPath });
          break;
        }
        case "db_query": {
          result = await execDbQuery(args as { query: string });
          break;
        }
        case "rollback_workspace": {
          result = execRollbackWorkspace(config.sandboxDir);
          break;
        }
        case "query_symbol": {
          result = execQuerySymbol(config.sandboxDir, args as { path: string; symbol: string });
          break;
        }
        case "spawn_subagent": {
          const a = args as { subtask: string; agentName: string };
          if ((config.subagentDepth ?? 0) >= 1) {
            result = { status: "error", summary: "Subagent depth limit reached — subagents cannot spawn further subagents." };
            break;
          }
          console.log(`[${config.agentName}:agent] Spawning subagent "${a.agentName}" to run subtask: ${a.subtask}`);
          try {
            const subagentResult = await runAgent({
              agentName: `${config.agentName}-${a.agentName}`,
              model: currentModel,
              apiKey: config.apiKey,
              systemPrompt: `You are a specialized subagent named "${a.agentName}" helper spawned by "${config.agentName}". Complete the delegated subtask: "${a.subtask}"`,
              initialMessage: a.subtask,
              sandboxDir: config.sandboxDir,
              projectId: config.projectId,
              enableHttpTools: config.enableHttpTools,
              enableDockerTools: config.enableDockerTools,
              subagentDepth: (config.subagentDepth ?? 0) + 1,
            });
            result = {
              status: subagentResult.success ? "success" : "error",
              summary: `Subagent completed with success=${subagentResult.success}`,
              output: subagentResult.summary,
            };
          } catch (err) {
            result = {
              status: "error",
              summary: `Failed to spawn or run subagent: ${String(err)}`,
            };
          }
          break;
        }
        case "escalate_finding": {
          const a = args as { target_agent: string; finding: string; reason: string };
          const { escalation, result: escalationResult } = recordEscalation(a);
          escalations.push(escalation);
          console.log(`[${config.agentName}:agent] Escalated finding to ${escalation.targetAgent}: ${escalation.reason.slice(0, 100)}`);
          result = escalationResult;
          break;
        }
        case "task_complete": {
          const a = args as { summary: string; files_written: string[]; verification_passed: boolean };
          // Phase 5 Task 3: default-FAIL completion gate — rejected without
          // fresh evidence, even if the model claims verification_passed.
          // Rejection falls through to the normal tool-result path below
          // (result assigned, no early return) so it counts toward
          // MAX_ITERATIONS — a model spamming task_complete still terminates.
          const check = checkCompletion(
            ledger,
            { summary: a.summary, filesWritten: a.files_written ?? [], verificationPassed: a.verification_passed },
            config.requiredVerificationCommands,
            config.requiredEvidenceKinds,
            config.allowFailedVerification,
          );
          if (!check.allowed) {
            console.log(`[${config.agentName}:agent] task_complete REJECTED on iteration ${iterations}: ${check.reason}`);
            result = { status: "error", summary: check.reason };
            break;
          }
          ledger.consume();
          console.log(`[${config.agentName}:agent] DONE after ${iterations} iterations. Verified: ${a.verification_passed}`);
          if (!a.verification_passed) {
            errors.push("Agent completed without verification passing");
          }
          await saveHistory();
          return {
            success: a.verification_passed,
            summary: a.summary,
            filesWritten: [...filesWritten, ...(a.files_written ?? [])].filter((v, i, arr) => arr.indexOf(v) === i),
            iterations,
            errors,
            escalations,
            ...(a.verification_passed ? {} : { escalationReason: "cannot_finish" as const }),
          };
        }
        default: {
          const mcpClient = mcpToolsMap.get(toolName);
          if (mcpClient) {
            try {
              const mcpResult = await mcpClient.callTool(toolName, args as Record<string, unknown>);
              result = {
                status: mcpResult.isError ? "error" : "success",
                summary: `MCP tool ${toolName} executed`,
                output: mcpResult.content.map((c) => c.text || "").join("\n"),
              };
            } catch (err) {
              result = { status: "error", summary: `MCP tool execution failed: ${String(err)}` };
            }
          } else if (browserToolset && BROWSER_TOOL_NAMES.has(toolName)) {
            result = await browserToolset.exec(toolName, args as Record<string, unknown>);
          } else {
            result = { status: "error", summary: `Unknown tool: ${toolName}` };
          }
        }
      }

      toolResults.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }

    messages.push(...toolResults);

    // Proactively compact history if it grows too large
    messages = await compactHistory(messages);

    // Phase 5 Task 4: the SAME command failed identically a 4th time after
    // already being told to pivot on strike 3 — stop retrying, let
    // runAgentEscalated (claude-loop.ts) fire with a logged reason instead
    // of burning the rest of MAX_ITERATIONS on a failure that won't resolve
    // itself.
    if (exhaustedThreeStrikes) {
      errors.push("Three-strikes exhausted: the same command failed identically 4 times");
      break;
    }
  }

  await saveHistory();
  return {
    success: false,
    summary: exhaustedThreeStrikes
      ? `Three-strikes exhausted (${iterations} real model turns completed)`
      : abortedOnTransportFailures
        ? `Aborted after ${MAX_CONSECUTIVE_TRANSPORT_FAILURES} consecutive transport failures (${iterations} real model turns completed)`
        : `Max iterations (${effectiveMaxIterations}) reached without task_complete`,
    filesWritten,
    iterations,
    errors: exhaustedThreeStrikes ? errors : [...errors, "Max iterations exceeded"],
    escalationReason: exhaustedThreeStrikes ? "three_strikes" : "cannot_finish",
    escalations,
  };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (browserToolset) await browserToolset.close();
    for (const client of mcpClients) {
      try {
        await client.stop();
      } catch (err) {
        console.error("[mcp] Failed to stop MCP Client:", err);
      }
    }
  }
}
