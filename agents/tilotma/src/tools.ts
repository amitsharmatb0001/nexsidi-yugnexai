// Tilotma's tool surface — each tool dispatches to one pipeline stage via Redis Streams.
// The betaZodTool + streaming tool runner (orchestrator.ts) handles the agentic loop;
// Tilotma calls these tools in sequence as it decides the best path.

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { publish, type AgentMessage } from "@nexsidi/agent-bus";
import { hashContext } from "@nexsidi/context-chain";
import { existsSync, readFileSync, renameSync } from "fs";
import { resolve } from "path";
import type Redis from "ioredis";

// Inline of apps/api/src/utils/steer.ts — avoids cross-app-boundary import.
// Fix #3: atomic STEER.md consumption (rename wins over delete to avoid race).
function consumeSteer(): string | null {
  const steerPath     = resolve(process.cwd(), "STEER.md");
  const processedPath = resolve(process.cwd(), ".STEER.processed");
  if (!existsSync(steerPath)) return null;
  try {
    renameSync(steerPath, processedPath);
    return readFileSync(processedPath, "utf-8").trim();
  } catch {
    return null;
  }
}

// Wait for an agent's response on a response-stream with a hard timeout.
// Phase 0: returns a stub after timeout (real agent not yet running).
// Phase 1: agents write their result to `nexsidi:bus:tilotma:${projectId}:${fromAgent}`
async function awaitAgentResponse(
  redis: Redis,
  projectId: string,
  fromAgent: string,
  timeoutMs = 120_000,
): Promise<unknown> {
  const responseKey = `nexsidi:bus:tilotma:${projectId}:${fromAgent}-result`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const entries = await redis.xread(
      "COUNT", "1",
      "BLOCK", "2000",
      "STREAMS", responseKey, "0-0",
    ) as Array<[string, Array<[string, string[]]>]> | null;

    if (entries) {
      for (const [, msgs] of entries) {
        for (const [id, fields] of msgs) {
          const dataIdx = fields.indexOf("data");
          if (dataIdx !== -1 && fields[dataIdx + 1]) {
            await redis.xdel(responseKey, id);
            return JSON.parse(fields[dataIdx + 1]);
          }
        }
      }
    }
  }

  // Phase 0 stub — remove once real agents are wired in Phase 1
  return { _stub: true, fromAgent, reason: "agent not yet running — Phase 0 skeleton" };
}

// Dispatch helper: build + hash + publish an AgentMessage
async function dispatch(
  redis: Redis,
  projectId: string,
  toAgent: string,
  payload: unknown,
): Promise<void> {
  const contextHash = hashContext(payload);
  const msg: AgentMessage = {
    fromAgent: "tilotma",
    toAgent,
    projectId,
    payload,
    contextHash,
    signature: "",  // Phase 1: sign with RSA-SHA256 (packages/context-chain/src/sign.ts)
    sentAt: Date.now(),
  };
  await publish(redis, msg);
}

export type StatusEmitter = (message: string, phase: string) => Promise<void>;

export function buildTilotmaTools(redis: Redis, projectId: string, emitStatus: StatusEmitter) {
  return [
    // ── Tool 1: Emit a plain-English status update to the user via Maya ──────
    betaZodTool({
      name: "emit_status_update",
      description:
        "Send a plain-English status update to the user. " +
        "Call this BEFORE starting each major pipeline stage and AFTER completing it. " +
        "Never mention agent names, internal scores, or iteration counts. " +
        "Be specific — 'Analyzing your requirements' beats 'Working on it'.",
      inputSchema: z.object({
        message: z.string().describe("User-visible message. No agent names or internal details."),
        phase: z.enum(["gathering", "planning", "generating", "qa", "deploying", "complete", "error"]),
      }),
      run: async ({ message, phase }) => {
        await emitStatus(message, phase);
        return `Status sent (phase=${phase})`;
      },
    }),

    // ── Tool 2: Check for a mid-flight STEER.md redirect from Amit ──────────
    betaZodTool({
      name: "check_steer_directive",
      description:
        "Check whether Amit has written a STEER.md redirect instruction. " +
        "Call this at the start of each pipeline stage. " +
        "If a directive is present, you MUST follow it and re-plan accordingly.",
      inputSchema: z.object({}),
      run: async () => {
        const steer = consumeSteer();
        if (!steer) return "No steer directive.";
        return `STEER DIRECTIVE (apply now): ${steer}`;
      },
    }),

    // ── Tool 3: Dispatch to requirements agent (Saanvi) ──────────────────────
    betaZodTool({
      name: "gather_requirements",
      description:
        "Send the user's request to the requirements agent. " +
        "It will produce a locked ProjectSpec JSON covering: " +
        "app type, feature list, data model, auth requirements, and success criteria. " +
        "Returns the ProjectSpec JSON or a list of clarifying questions.",
      inputSchema: z.object({
        userRequest: z.string().describe("The sanitized user request text."),
        clarifications: z
          .array(z.string())
          .optional()
          .describe("Any answers to previous clarifying questions."),
      }),
      run: async ({ userRequest, clarifications }) => {
        await dispatch(redis, projectId, "saanvi", { userRequest, clarifications });
        const result = await awaitAgentResponse(redis, projectId, "saanvi", 180_000);
        return JSON.stringify(result);
      },
    }),

    // ── Tool 4: Dispatch to planner (Arjun) ─────────────────────────────────
    betaZodTool({
      name: "plan_project",
      description:
        "Send the locked ProjectSpec to the planner agent. " +
        "It produces: full REST API contract (every endpoint + request/response shape), " +
        "database schema (every table + relation), " +
        "and an independence-checked parallel task list for the code generators. " +
        "The planner is AMBITIOUS — it designs real systems, not toy demos.",
      inputSchema: z.object({
        projectSpec: z.string().describe("The locked ProjectSpec JSON from gather_requirements."),
      }),
      run: async ({ projectSpec }) => {
        const spec = JSON.parse(projectSpec) as unknown;
        await dispatch(redis, projectId, "arjun", { projectSpec: spec });
        const result = await awaitAgentResponse(redis, projectId, "arjun", 180_000);
        return JSON.stringify(result);
      },
    }),

    // ── Tool 5: Dispatch code generators in parallel (Shubham + Aanya + Pranav)
    betaZodTool({
      name: "generate_app",
      description:
        "Dispatch to all three code generators simultaneously. " +
        "They run in separate git worktrees and must not depend on each other's in-progress work. " +
        "Shubham builds the Express backend, Aanya the Next.js 16.2 frontend, " +
        "Pranav the Drizzle migrations. " +
        "Returns the merge status and any conflicts that need resolution.",
      inputSchema: z.object({
        apiContract: z.string().describe("Full REST API contract JSON from plan_project."),
        dbSchema: z.string().describe("Database schema JSON from plan_project."),
        taskList: z.string().describe("Parallel task list JSON from plan_project."),
        iteration: z.number().int().min(1).describe("Current generation iteration (1 = first attempt)."),
      }),
      run: async ({ apiContract, dbSchema, taskList, iteration }) => {
        const payload = { apiContract, dbSchema, taskList, iteration };

        // Fire all 3 generators in parallel — different models avoid the 40 RPM NIM collision
        await Promise.all([
          dispatch(redis, projectId, "shubham", payload),
          dispatch(redis, projectId, "aanya", payload),
          dispatch(redis, projectId, "pranav", payload),
        ]);

        // Wait for all 3 responses
        const [backend, frontend, migrations] = await Promise.all([
          awaitAgentResponse(redis, projectId, "shubham", 300_000),
          awaitAgentResponse(redis, projectId, "aanya", 300_000),
          awaitAgentResponse(redis, projectId, "pranav", 300_000),
        ]);

        return JSON.stringify({ backend, frontend, migrations });
      },
    }),

    // ── Tool 6: Run adversarial QA gate (Navya + Karan + Deepika) ────────────
    betaZodTool({
      name: "run_qa_review",
      description:
        "Run the adversarial QA gate. Three independent QA agents attack the generated code " +
        "from different angles simultaneously. ALL THREE must score ≥85/100 to pass. " +
        "Score = 100 − (CRITICAL×20) − (HIGH×10) − (MEDIUM×5) − (LOW×1). " +
        "A critical finding from any reviewer is a blocking failure. " +
        "Returns each reviewer's score, findings list, and overall pass/fail.",
      inputSchema: z.object({
        worktreePath: z.string().describe("Absolute path to the merged code worktree."),
        iteration: z.number().int().min(1).describe("Current QA iteration number."),
      }),
      run: async ({ worktreePath, iteration }) => {
        const payload = { worktreePath, iteration };

        // Fire all 3 QA agents in parallel — different models by design (D43)
        await Promise.all([
          dispatch(redis, projectId, "navya", payload),   // Kimi K2.6 — logic/race conditions
          dispatch(redis, projectId, "karan", payload),   // Kimi K2.6 — security/OWASP
          dispatch(redis, projectId, "deepika", payload), // MiniMax M3 — performance/N+1
        ]);

        const [navyaResult, karanResult, deepikaResult] = await Promise.all([
          awaitAgentResponse(redis, projectId, "navya", 300_000),
          awaitAgentResponse(redis, projectId, "karan", 300_000),
          awaitAgentResponse(redis, projectId, "deepika", 300_000),
        ]);

        // Each result must have a `score` field and `passed` boolean
        // All three must pass — D18/Fix #8: independent per-agent threshold
        const results = { navya: navyaResult, karan: karanResult, deepika: deepikaResult };
        return JSON.stringify(results);
      },
    }),

    // ── Tool 7: Deploy with Riya (Docker Compose → localhost:3000) ───────────
    betaZodTool({
      name: "deploy_app",
      description:
        "Hand the merged, QA-passed code to the DevOps agent. " +
        "It generates docker-compose.yml, runs docker-compose up, " +
        "and returns the URL when the app is reachable. " +
        "Also archives the source to a new GitHub repo under the user's org.",
      inputSchema: z.object({
        worktreePath: z.string().describe("Absolute path to the merged, QA-passed code."),
      }),
      run: async ({ worktreePath }) => {
        await dispatch(redis, projectId, "riya", { worktreePath });
        const result = await awaitAgentResponse(redis, projectId, "riya", 300_000);
        return JSON.stringify(result);
      },
    }),

    // ── Tool 8: Request human approval (Patent Claim 8 — OTP gate) ──────────
    betaZodTool({
      name: "request_human_approval",
      description:
        "Pause the pipeline and ask the user for explicit approval before a DESTRUCTIVE " +
        "or PRIVILEGED action (D33/D34). Use for: production deployments, schema drops, " +
        "secret rotation, or any action Tilotma judges risky. " +
        "In development mode this is auto-approved; in production an OTP is required.",
      inputSchema: z.object({
        action: z.string().describe("Plain-English description of the action requiring approval."),
        riskClass: z.enum(["DESTRUCTIVE", "PRIVILEGED"]).describe("Permission harness risk class."),
      }),
      run: async ({ action, riskClass }) => {
        // Phase 0: auto-approve in dev; Phase 1: OTP flow via Maya + browser UI
        const isDev = process.env.NODE_ENV !== "production";
        if (isDev) {
          return JSON.stringify({
            approved: true,
            approvedBy: "policy:dev-auto-approve",
            action,
            riskClass,
          });
        }

        // Publish approval request to Maya so the user sees it and enters OTP
        await dispatch(redis, projectId, "maya", {
          type: "approval_request",
          action,
          riskClass,
        });

        // Wait for approval response (5 min timeout)
        const approval = await awaitAgentResponse(redis, projectId, "approval", 300_000) as
          | { approved: boolean; approvedBy: string }
          | { _stub: true };

        if ("_stub" in approval) {
          return JSON.stringify({ approved: false, reason: "approval timeout — no response from user" });
        }

        return JSON.stringify(approval);
      },
    }),
  ] as const;
}
