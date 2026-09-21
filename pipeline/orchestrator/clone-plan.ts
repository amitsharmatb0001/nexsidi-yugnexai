// Planning step for clone-with-changes (2026-09-02, real user request, after
// a live test showed the exact failure this fixes): a request that needs
// backend/DB work, handed to a frontend-only agent with zero upfront
// knowledge of what already exists, burned its ENTIRE 25-iteration budget
// re-discovering the project's own structure by reading files one at a time
// before ever attempting the real work, then ran out of budget mid-edit.
// This is a cheap, single, non-agentic call (no tools, no file access) that
// reads the project's REAL, already-generated api-contract.json and
// db-schema.json (Arjun's own as-built artifacts — precise, not Saanvi's
// simplified spec.json) and decides, before any building starts: does this
// need new backend/DB work, and what exactly should each layer build. Uses
// "arjun" as the agentChat routing identity since this is literally his job
// (assess a request against structure, produce a plan) — reusing his model
// config rather than fragmenting routing further for one new call site.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentChat, type AgentName, type ChatMessage } from "@nexsidi/llm-client";
import { execListFiles } from "../../packages/agent-runtime/src/tools/file.ts";

export interface CloneChangePlan {
  needsBackendChanges: boolean;
  reasoning: string;
  backendInstructions: string | null;
  frontendInstructions: string;
}

// 2026-09-02: real live test found the actual cost of NOT doing this — the
// frontend builder spent roughly half of a 40-iteration run re-reading
// unrelated existing components (cart, orders, order history) hunting for a
// pattern to copy before writing one new list-rendering component, then
// still ran out of budget. The planner already gets api-contract.json/
// db-schema.json for backend structure; this is the same idea for the
// frontend — a real file LISTING (paths only, not content — a directory
// listing costs nothing, unlike reading every file) so the plan can name an
// exact existing file as "build this like that one" instead of the builder
// discovering it the expensive way, one read_file at a time.
export function buildPlanPrompt(
  changes: string,
  apiContract: unknown,
  dbSchema: unknown,
  backendFileList: string,
  frontendFileList: string,
): string {
  return `A user wants to apply this change to an already-delivered app that's being cloned:
"${changes}"

The app's REAL, CURRENT backend already has these endpoints:
${JSON.stringify(apiContract, null, 2)}

The app's REAL, CURRENT database already has these tables:
${JSON.stringify(dbSchema, null, 2)}

The app's REAL, CURRENT backend file structure (backend/):
${backendFileList || "(no backend files found)"}

The app's REAL, CURRENT frontend file structure (frontend/):
${frontendFileList || "(no frontend files found)"}

Decide: can this change be made ENTIRELY within the frontend, reusing what already exists above? Or does it genuinely need a NEW backend endpoint, or a NEW/changed database table or column that isn't listed above?

When you describe what to build, ALSO name the single closest existing file from the real file structure above that already does something similar, and say to model the new work after it — exact conventions (styling approach, data-fetching pattern, error handling), not just similar purpose. A named real file the builder can open immediately beats a generic description it has to go search for.

Respond with ONLY this JSON shape, no other text, no markdown fences:
{
  "needsBackendChanges": boolean,
  "reasoning": "one sentence citing what already exists vs what's actually missing",
  "backendInstructions": "a clear, specific brief for exactly what to build on the backend, naming an exact existing file (e.g. src/routes/orders.routes.ts) to model it after — or null if not needed",
  "frontendInstructions": "a clear, specific brief for what to build/wire on the frontend, naming an exact existing file to model new components after, and referencing the backend's new endpoints by path if any were planned"
}`;
}

// Same tolerant extraction Arjun's own spec-lock parsing uses (fenced code
// block first, then brace-slicing) — models routinely wrap JSON in
// ```json fences despite being told not to.
export function parseCloneChangePlan(raw: string): CloneChangePlan {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let jsonText: string;
  if (fenceMatch?.[1]) {
    jsonText = fenceMatch[1];
  } else {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error(`clone change plan: no JSON object found in response: ${raw.slice(0, 300)}`);
    }
    jsonText = raw.slice(start, end + 1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`clone change plan: could not parse JSON (${String(err)}): ${raw.slice(0, 300)}`);
  }

  if (typeof parsed.needsBackendChanges !== "boolean" || typeof parsed.frontendInstructions !== "string") {
    throw new Error(`clone change plan: missing required fields (needsBackendChanges: boolean, frontendInstructions: string): ${raw.slice(0, 300)}`);
  }

  return {
    needsBackendChanges: parsed.needsBackendChanges,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    backendInstructions: typeof parsed.backendInstructions === "string" ? parsed.backendInstructions : null,
    frontendInstructions: parsed.frontendInstructions,
  };
}

export type PlanChatFn = (agentName: AgentName, messages: ChatMessage[], apiKey: string) => Promise<{ content: string }>;

export interface PlanCloneChangesDeps {
  chatFn?: PlanChatFn;
  readFn?: (path: string) => string;
  existsFn?: (path: string) => boolean;
  // Returns a newline-joined relative-path listing, or "" when the
  // directory doesn't exist / listing fails — same shape execListFiles
  // returns on success, so the default wraps that exact function (the
  // agent's own real list_files tool) rather than a second implementation
  // that could drift from what the builder actually sees.
  listFilesFn?: (dir: string) => string;
}

function defaultListFiles(dir: string): string {
  if (!existsSync(dir)) return "";
  const result = execListFiles(dir, { dir: ".", recursive: true });
  return result.status === "success" ? (result.output ?? "") : "";
}

export async function planCloneChanges(
  opts: { buildDir: string; changes: string; apiKey: string },
  deps: PlanCloneChangesDeps = {},
): Promise<CloneChangePlan> {
  const existsFn = deps.existsFn ?? existsSync;
  const readFn = deps.readFn ?? ((p: string) => readFileSync(p, "utf-8"));
  const chatFn = deps.chatFn ?? agentChat;
  const listFilesFn = deps.listFilesFn ?? defaultListFiles;

  const contractPath = join(opts.buildDir, "api-contract.json");
  const schemaPath = join(opts.buildDir, "db-schema.json");
  // Older clones or a partial build may lack these as-built artifacts —
  // degrade to "nothing known to exist" rather than throwing, so planning
  // still runs (conservatively assuming more is missing than might be true).
  const apiContract = existsFn(contractPath) ? JSON.parse(readFn(contractPath)) : { endpoints: [] };
  const dbSchema = existsFn(schemaPath) ? JSON.parse(readFn(schemaPath)) : { tables: [] };
  const backendFileList = listFilesFn(join(opts.buildDir, "backend"));
  const frontendFileList = listFilesFn(join(opts.buildDir, "frontend"));

  const prompt = buildPlanPrompt(opts.changes, apiContract, dbSchema, backendFileList, frontendFileList);
  const { content } = await chatFn("arjun", [{ role: "user", content: prompt }], opts.apiKey);
  return parseCloneChangePlan(content);
}
