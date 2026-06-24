// Tilotma's tool surface — each tool dispatches to one pipeline stage via Redis Streams.
// Uses standard BetaTool JSON schema format (SDK 0.55) + a handlers map for execution.

import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { publish, type AgentMessage } from "@nexsidi/agent-bus";
import { hashContext } from "@nexsidi/context-chain";
import { existsSync, readFileSync, renameSync } from "fs";
import { resolve } from "path";
import type Redis from "ioredis";

export type ToolHandler = (input: Record<string, unknown>) => Promise<string>;

export type StatusEmitter = (message: string, phase: string) => Promise<void>;

// Inline of apps/api/src/utils/steer.ts — avoids cross-app-boundary import.
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

// Wait for an agent's response on a Redis Stream.
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
            return JSON.parse(fields[dataIdx + 1] as string);
          }
        }
      }
    }
  }

  return { _stub: true, fromAgent, reason: "agent not yet running" };
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
    signature: "",
    sentAt: Date.now(),
  };
  await publish(redis, msg);
}

// Returns the tool JSON schema definitions (for Claude) and a handlers map (for execution).
export function buildTilotmaTools(
  redis: Redis,
  projectId: string,
  emitStatus: StatusEmitter,
): { definitions: BetaTool[]; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();

  const definitions: BetaTool[] = [
    // ── Tool 1: Emit a plain-English status update to the user via Maya ──────
    {
      name: "emit_status_update",
      description:
        "Send a plain-English status update to the user. " +
        "Call this BEFORE starting each major pipeline stage and AFTER completing it. " +
        "Never mention agent names, internal scores, or iteration counts. " +
        "Be specific — 'Analyzing your requirements' beats 'Working on it'.",
      input_schema: {
        type: "object",
        properties: {
          message: { type: "string", description: "User-visible message. No agent names or internal details." },
          phase: {
            type: "string",
            enum: ["gathering", "planning", "generating", "qa", "deploying", "complete", "error"],
          },
        },
        required: ["message", "phase"],
      },
    },

    // ── Tool 2: Check for a mid-flight STEER.md redirect ─────────────────────
    {
      name: "check_steer_directive",
      description:
        "Check whether a STEER.md redirect instruction has been written. " +
        "Call this at the start of each pipeline stage. " +
        "If a directive is present, you MUST follow it and re-plan accordingly.",
      input_schema: { type: "object", properties: {}, required: [] },
    },

    // ── Tool 3: Dispatch to requirements agent (Saanvi) ──────────────────────
    {
      name: "gather_requirements",
      description:
        "Send the user's request to the requirements agent. " +
        "It will produce a locked ProjectSpec JSON covering: " +
        "app type, feature list, data model, auth requirements, and success criteria. " +
        "Returns the ProjectSpec JSON or a list of clarifying questions.",
      input_schema: {
        type: "object",
        properties: {
          userRequest: { type: "string", description: "The sanitized user request text." },
          clarifications: {
            type: "array",
            items: { type: "string" },
            description: "Any answers to previous clarifying questions.",
          },
        },
        required: ["userRequest"],
      },
    },

    // ── Tool 4: Dispatch to planner (Arjun) ─────────────────────────────────
    {
      name: "plan_project",
      description:
        "Send the locked ProjectSpec to the planner agent. " +
        "It produces: full REST API contract (every endpoint + request/response shape), " +
        "database schema (every table + relation), " +
        "and an independence-checked parallel task list for the code generators. " +
        "The planner is AMBITIOUS — it designs real systems, not toy demos.",
      input_schema: {
        type: "object",
        properties: {
          projectSpec: { type: "string", description: "The locked ProjectSpec JSON from gather_requirements." },
        },
        required: ["projectSpec"],
      },
    },

    // ── Tool 5: Dispatch code generators in parallel (Shubham + Aanya + Pranav)
    {
      name: "generate_app",
      description:
        "Dispatch to all three code generators simultaneously. " +
        "They run in separate git worktrees and must not depend on each other's in-progress work. " +
        "Shubham builds the Express backend, Aanya the Next.js 16.2 frontend, " +
        "Pranav the Drizzle migrations. " +
        "Returns the merge status and any conflicts that need resolution.",
      input_schema: {
        type: "object",
        properties: {
          apiContract: { type: "string", description: "Full REST API contract JSON from plan_project." },
          dbSchema:    { type: "string", description: "Database schema JSON from plan_project." },
          taskList:    { type: "string", description: "Parallel task list JSON from plan_project." },
          iteration:   { type: "number", description: "Current generation iteration (1 = first attempt)." },
        },
        required: ["apiContract", "dbSchema", "taskList", "iteration"],
      },
    },

    // ── Tool 6: Run adversarial QA gate (Navya + Karan + Deepika) ────────────
    {
      name: "run_qa_review",
      description:
        "Run the adversarial QA gate. Three independent QA agents attack the generated code " +
        "from different angles simultaneously. ALL THREE must score ≥85/100 to pass. " +
        "Score = 100 − (CRITICAL×20) − (HIGH×10) − (MEDIUM×5) − (LOW×1). " +
        "A critical finding from any reviewer is a blocking failure. " +
        "Returns each reviewer's score, findings list, and overall pass/fail.",
      input_schema: {
        type: "object",
        properties: {
          worktreePath: { type: "string", description: "Absolute path to the merged code worktree." },
          iteration:    { type: "number", description: "Current QA iteration number." },
        },
        required: ["worktreePath", "iteration"],
      },
    },

    // ── Tool 7: Deploy with Riya (Docker Compose → localhost:3000) ───────────
    {
      name: "deploy_app",
      description:
        "Hand the merged, QA-passed code to the DevOps agent. " +
        "It generates docker-compose.yml, runs docker-compose up, " +
        "and returns the URL when the app is reachable. " +
        "Also archives the source to a new GitHub repo.",
      input_schema: {
        type: "object",
        properties: {
          worktreePath: { type: "string", description: "Absolute path to the merged, QA-passed code." },
        },
        required: ["worktreePath"],
      },
    },

    // ── Tool 8: Request human approval (Patent Claim 8 — OTP gate) ──────────
    {
      name: "request_human_approval",
      description:
        "Pause the pipeline and ask the user for explicit approval before a DESTRUCTIVE " +
        "or PRIVILEGED action (D33/D34). Use for: production deployments, schema drops, " +
        "secret rotation, or any action judged risky. " +
        "In development mode this is auto-approved; in production an OTP is required.",
      input_schema: {
        type: "object",
        properties: {
          action:    { type: "string", description: "Plain-English description of the action requiring approval." },
          riskClass: { type: "string", enum: ["DESTRUCTIVE", "PRIVILEGED"], description: "Permission harness risk class." },
        },
        required: ["action", "riskClass"],
      },
    },
  ];

  // ── Handlers (keyed by tool name) ─────────────────────────────────────────
  handlers.set("emit_status_update", async (input) => {
    const message = input["message"] as string;
    const phase   = input["phase"] as string;
    await emitStatus(message, phase);
    return `Status sent (phase=${phase})`;
  });

  handlers.set("check_steer_directive", async () => {
    const steer = consumeSteer();
    if (!steer) return "No steer directive.";
    return `STEER DIRECTIVE (apply now): ${steer}`;
  });

  handlers.set("gather_requirements", async (input) => {
    const userRequest    = input["userRequest"] as string;
    const clarifications = input["clarifications"] as string[] | undefined;
    await dispatch(redis, projectId, "saanvi", { userRequest, clarifications });
    const result = await awaitAgentResponse(redis, projectId, "saanvi", 180_000);
    return JSON.stringify(result);
  });

  handlers.set("plan_project", async (input) => {
    const projectSpec = input["projectSpec"] as string;
    const spec = JSON.parse(projectSpec) as unknown;
    await dispatch(redis, projectId, "arjun", { projectSpec: spec });
    const result = await awaitAgentResponse(redis, projectId, "arjun", 180_000);
    return JSON.stringify(result);
  });

  handlers.set("generate_app", async (input) => {
    const payload = {
      apiContract: input["apiContract"] as string,
      dbSchema:    input["dbSchema"] as string,
      taskList:    input["taskList"] as string,
      iteration:   input["iteration"] as number,
    };
    await Promise.all([
      dispatch(redis, projectId, "shubham", payload),
      dispatch(redis, projectId, "aanya",   payload),
      dispatch(redis, projectId, "pranav",  payload),
    ]);
    const [backend, frontend, migrations] = await Promise.all([
      awaitAgentResponse(redis, projectId, "shubham", 300_000),
      awaitAgentResponse(redis, projectId, "aanya",   300_000),
      awaitAgentResponse(redis, projectId, "pranav",  300_000),
    ]);
    return JSON.stringify({ backend, frontend, migrations });
  });

  handlers.set("run_qa_review", async (input) => {
    const payload = { worktreePath: input["worktreePath"] as string, iteration: input["iteration"] as number };
    await Promise.all([
      dispatch(redis, projectId, "navya",   payload),
      dispatch(redis, projectId, "karan",   payload),
      dispatch(redis, projectId, "deepika", payload),
    ]);
    const [navya, karan, deepika] = await Promise.all([
      awaitAgentResponse(redis, projectId, "navya",   300_000),
      awaitAgentResponse(redis, projectId, "karan",   300_000),
      awaitAgentResponse(redis, projectId, "deepika", 300_000),
    ]);
    return JSON.stringify({ navya, karan, deepika });
  });

  handlers.set("deploy_app", async (input) => {
    await dispatch(redis, projectId, "riya", { worktreePath: input["worktreePath"] as string });
    const result = await awaitAgentResponse(redis, projectId, "riya", 300_000);
    return JSON.stringify(result);
  });

  handlers.set("request_human_approval", async (input) => {
    const action    = input["action"] as string;
    const riskClass = input["riskClass"] as string;
    const isDev = process.env["NODE_ENV"] !== "production";
    if (isDev) {
      return JSON.stringify({ approved: true, approvedBy: "policy:dev-auto-approve", action, riskClass });
    }
    await dispatch(redis, projectId, "maya", { type: "approval_request", action, riskClass });
    const approval = await awaitAgentResponse(redis, projectId, "approval", 300_000) as
      | { approved: boolean; approvedBy: string }
      | { _stub: true };
    if ("_stub" in approval) {
      return JSON.stringify({ approved: false, reason: "approval timeout" });
    }
    return JSON.stringify(approval);
  });

  return { definitions, handlers };
}
