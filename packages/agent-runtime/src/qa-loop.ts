// 2026-07-11: QA exploration loop — Navya/Karan/Deepika previously reviewed
// generated code as a single one-shot call over a dumped text blob of the
// ENTIRE codebase, with no tools and no way to check their own claim before
// finalizing it. Root-caused live (stress-fix2-1783753726): Navya cited a
// `queryWhere` mutation that never happened in the actual code — pure
// pattern-matching on "this shape of code usually has this bug", not
// verified tracing, because the one-shot call had no mechanism to verify.
//
// This gives the QA agents the SAME tool-calling loop Shubham/Aanya already
// have (see gemini-loop.ts) — explore file by file via list_files/read_file,
// then submit_findings — gated by finding-evidence.ts so a finding citing a
// file the agent never actually read is rejected and it has to go check.
import {
  routeToolsWithFallback,
  translateNimToolToGeminiTool,
  type GeminiMessage,
  type GeminiToolDef,
  type GeminiPart,
  type NimToolDef,
} from "@nexsidi/llm-client";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { assembleSystemPrompt } from "./prompt-assembly.ts";
import { checkFindingsEvidence, checkReviewCoverage } from "./enforce/finding-evidence.ts";
import { detectStuckLoop } from "./enforce/stuck-loop.ts";
import { compactGeminiHistory } from "./compaction.ts";

// 2026-07-24 (W0.3): this loop previously had NO compaction at all. 2026-
// 07-25 (Phase 0.3): matches gemini-loop.ts's threshold — 40K was 4% of the
// documented 1M input window for every provisioned model (gemini_3_1_pro.md
// etc., E:/ai yug/), amnesiac far too early for a 30-iteration exploration.
const QA_COMPACTION_THRESHOLD_TOKENS = 750_000;

export { detectStuckLoop };

export const QA_MAX_ITERATIONS = 30;

export interface LabeledDir {
  label: string; // "backend" | "frontend" — must match identifyFaultAgent's prefix check
  path: string;
}

export interface Finding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
  detail: string;
  file?: string;
  // 2026-07-24 (P2, full agentic upgrade): a finding with `file` but no
  // `line` still forces the generator to re-read and re-scan the whole
  // file to locate the issue — the exact "broad refactor, new errors,
  // score oscillates 83->69" failure mode this session's forensic audit
  // traced. Optional (not every finding is line-attributable — e.g. a
  // missing-file or architecture-level issue), but required whenever the
  // model is citing something inside a file it already read.
  line?: number;
}

export interface QAAgentConfig {
  agentName: string;
  systemPrompt: string;
  reviewFocus: string; // e.g. "security vulnerabilities (OWASP-style)"
  dirs: LabeledDir[];
}

export interface QAAgentResult {
  findings: Finding[];
  iterations: number;
  errors: string[];
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".prisma", ".json", ".yaml", ".yml", ".css", ".scss", ".html", ".md"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build"]);
const READ_FILE_CHAR_LIMIT = 8000;

// Exported for direct unit testing without touching the filesystem-walking
// pieces above them.
export function listLabeledFiles(dirs: LabeledDir[]): string[] {
  const out: string[] = [];
  for (const { label, path } of dirs) walkLabeled(path, path, label, out);
  return out;
}

function walkLabeled(root: string, dir: string, label: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // directory doesn't exist (yet) or unreadable — skip, don't throw
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat: import("node:fs").Stats;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkLabeled(root, full, label, out);
    } else if (stat.isFile() && CODE_EXTENSIONS.has(extname(entry))) {
      out.push(`${label}/${full.slice(root.length + 1).replace(/\\/g, "/")}`);
    }
  }
}

export function resolveLabeledFile(dirs: LabeledDir[], labeledPath: string): string | null {
  for (const { label, path } of dirs) {
    const prefix = `${label}/`;
    if (labeledPath.startsWith(prefix)) {
      return join(path, labeledPath.slice(prefix.length));
    }
  }
  return null;
}

const QA_TOOL_DEFS: NimToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List every reviewable source file across the project, as labeled paths like 'backend/src/index.ts' or 'frontend/app/page.tsx'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file by its labeled path (from list_files' output, e.g. 'backend/src/controllers/tasks.ts'). You MUST read a file before citing it in a finding — findings citing an unread file are rejected.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Labeled path from list_files" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_findings",
      description: "Submit your final findings after reviewing the code. Every finding with a `file` field must be a file you already called read_file on. Whenever you cite a `file`, also cite the exact `line` number the issue is on (read_file's output — count from its start) so the fix can target that line directly instead of re-scanning the whole file. Call with an empty findings array if you found nothing.",
      parameters: {
        type: "object",
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                severity: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] },
                category: { type: "string" },
                detail: { type: "string" },
                file: { type: "string" },
                line: { type: "integer", description: "1-indexed line number within `file` where the issue is — omit only if the finding isn't attributable to a single line." },
              },
              required: ["severity", "category", "detail"],
            },
          },
        },
        required: ["findings"],
      },
    },
  },
];

export async function runQAAgent(config: QAAgentConfig): Promise<QAAgentResult> {
  const tools: GeminiToolDef[] = QA_TOOL_DEFS.map(translateNimToolToGeminiTool);
  const systemPrompt = assembleSystemPrompt({ agentName: config.agentName, basePrompt: config.systemPrompt });

  let messages: GeminiMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        `Review this codebase for ${config.reviewFocus}. Call list_files first to see every file, then ` +
        `read_file on the files relevant to your review — read broadly, not just one file, before concluding. ` +
        `You must read a file before you can cite it in a finding, and submit_findings will be rejected if you've ` +
        `barely looked at the codebase. Call submit_findings when done (empty findings array if you found nothing).`,
    },
  ];

  const readFiles = new Set<string>();
  const errors: string[] = [];
  const recentCallSignatures: string[] = [];
  let iterations = 0;
  let totalFilesListed = 0;

  while (iterations < QA_MAX_ITERATIONS) {
    iterations++;

    // 2026-07-24 (W0.3): proactive compaction — checked before the call it
    // protects, not reactively after (see gemini-loop.ts for the same
    // pattern and why "after" leaves the first oversized request unguarded).
    messages = await compactGeminiHistory(messages, undefined, QA_COMPACTION_THRESHOLD_TOKENS);

    let response;
    try {
      // 2026-07-24 (W0.2): route through the "qa" tier pool
      // (gemini-3.1-pro-preview, thinking_level:HIGH, with zero-wait
      // fallback to gemini-3.6-flash / gemini-3.5-flash on failure) instead
      // of the un-tiered geminiChatWithTools(messages, tools) call this used
      // to make — which silently defaulted every real GAN review to
      // gemini-3.5-flash regardless of the TIER_POOLS config.
      response = await routeToolsWithFallback("qa", messages, tools);
      if (iterations === 1) {
        console.log(`[${config.agentName}:qa-loop] model=${response.modelUsed}`);
      }
    } catch (err) {
      errors.push(`Gemini call failed on iteration ${iterations}: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    // Same empty-rawParts guard as gemini-loop.ts — a severely truncated
    // response can come back with zero parts, and Gemini's API requires
    // every history entry to have at least one.
    messages.push({ role: "model", content: response.rawParts.length > 0 ? response.rawParts : [{ text: "(response truncated, no content)" }] });

    if (response.toolCalls.length === 0) {
      if (response.stopReason === "STOP" || response.stopReason === null) {
        console.log(`[${config.agentName}:qa-loop] Agent stopped without calling submit_findings. Running fallback parser...`);
        const fallbackFindings = await extractFindingsFromHistory(messages, config.agentName, readFiles);
        return { findings: fallbackFindings, iterations, errors };
      }
      continue;
    }

    const turnSignature = response.toolCalls.map((c) => `${c.name}:${JSON.stringify(c.input)}`).join("|");
    recentCallSignatures.push(turnSignature);
    if (detectStuckLoop(recentCallSignatures)) {
      const reason = `Stuck: ${config.agentName} repeated the identical tool call (${turnSignature.slice(0, 150)}) 3 turns in a row with no progress — stopped early instead of grinding to the ${QA_MAX_ITERATIONS}-iteration cap.`;
      console.log(`[${config.agentName}:qa-loop] ${reason}`);
      errors.push(reason);
      const fallbackFindings = await extractFindingsFromHistory(messages, config.agentName, readFiles);
      return { findings: fallbackFindings, iterations, errors };
    }

    const responseParts: GeminiPart[] = [];
    let submitted: Finding[] | null = null;

    for (const call of response.toolCalls) {
      console.log(`[${config.agentName}:qa-loop] Tool call: ${call.name}(${JSON.stringify(call.input).slice(0, 120)})`);
      let result: Record<string, unknown>;

      switch (call.name) {
        case "list_files": {
          const files = listLabeledFiles(config.dirs);
          totalFilesListed = files.length;
          result = { status: "success", summary: `${files.length} files`, output: files.join("\n") };
          break;
        }
        case "read_file": {
          const path = (call.input as { path: string }).path;
          const abs = path ? resolveLabeledFile(config.dirs, path) : null;
          if (!abs || !existsSync(abs)) {
            result = { status: "error", summary: `File not found: ${path} — use list_files to see valid paths` };
            break;
          }
          try {
            let content = readFileSync(abs, "utf-8");
            if (content.length > READ_FILE_CHAR_LIMIT) {
              content = content.slice(0, READ_FILE_CHAR_LIMIT) + `\n...[truncated, ${content.length - READ_FILE_CHAR_LIMIT} more chars]`;
            }
            readFiles.add(path);
            result = { status: "success", summary: `Read ${path}`, output: content };
          } catch (err) {
            result = { status: "error", summary: `read_file failed: ${String(err)}` };
          }
          break;
        }
        case "submit_findings": {
          const findings = ((call.input as { findings?: Finding[] }).findings ?? []);
          const coverage = checkReviewCoverage(readFiles.size, totalFilesListed);
          if (!coverage.allowed) {
            result = { status: "error", summary: coverage.reason };
            break;
          }
          const check = checkFindingsEvidence(findings, readFiles);
          if (!check.allowed) {
            result = { status: "error", summary: check.reason };
            break;
          }
          result = { status: "success", summary: "Findings accepted" };
          submitted = findings;
          break;
        }
        default:
          result = { status: "error", summary: `Unknown tool: ${call.name}` };
      }

      responseParts.push({ functionResponse: { name: call.name, response: result } });
    }

    if (submitted !== null) {
      return { findings: submitted, iterations, errors };
    }

    messages.push({ role: "user", content: responseParts });
  }

  console.log(`[${config.agentName}:qa-loop] Max iterations reached without submit_findings. Running fallback parser...`);
  const fallbackFindings = await extractFindingsFromHistory(messages, config.agentName, readFiles);
  return { findings: fallbackFindings, iterations, errors };
}

async function extractFindingsFromHistory(
  messages: GeminiMessage[],
  agentName: string,
  readFiles: ReadonlySet<string>,
): Promise<Finding[]> {
  try {
    const { geminiChat } = await import("@nexsidi/llm-client");

    const chatMessages: any[] = [];
    for (const m of messages) {
      if (m.role === "system") {
        chatMessages.push({ role: "system", content: m.content });
      } else if (m.role === "user") {
        let content = "";
        if (typeof m.content === "string") {
          content = m.content;
        } else if (Array.isArray(m.content)) {
          content = m.content
            .map((part) => {
              if ("text" in part) return part.text;
              if ("functionResponse" in part) return `Tool result for ${part.functionResponse.name}: ${JSON.stringify(part.functionResponse.response)}`;
              return "";
            })
            .join("\n");
        }
        chatMessages.push({ role: "user", content });
      } else if (m.role === "model") {
        let content = "";
        if (Array.isArray(m.content)) {
          content = m.content
            .map((part) => {
              if ("text" in part) return part.text;
              if ("functionCall" in part) return `Tool call: ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`;
              return "";
            })
            .join("\n");
        }
        chatMessages.push({ role: "assistant", content });
      }
    }

    chatMessages.push({
      role: "user",
      content:
        `Read the above conversation. The ${agentName} QA agent was reviewing a codebase. ` +
        `Extract any bugs, logic flaws, security vulnerabilities, or performance issues the agent identified and mentioned in its text messages. ` +
        `Output ONLY a valid JSON object matching this schema, with no markdown fences, no formatting: \n` +
        `{\n` +
        `  "findings": [\n` +
        `    {\n` +
        `      "severity": "CRITICAL | HIGH | MEDIUM | LOW",\n` +
        `      "category": "string (e.g. security-owasp, performance-n+1, logic-null-ptr)",\n` +
        `      "detail": "precise description of the issue",\n` +
        `      "file": "best-effort relative path prefix e.g. backend/src/controllers/tasks.ts"\n` +
        `    }\n` +
        `  ]\n` +
        `}\n` +
        `If the agent did not identify any actual issues or if the review was clean/empty, output: {"findings": []}.`,
    });

    const response = await geminiChat(chatMessages);
    const trimmed = response.content.trim();
    const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
    const cleanJsonText = fenceMatch ? fenceMatch[1]! : trimmed;
    const parsed = JSON.parse(cleanJsonText) as { findings?: Finding[] };
    const extracted = parsed.findings ?? [];

    return extracted.filter(f => !f.file || readFiles.has(f.file));
  } catch (err) {
    console.error(`[qa-loop] Fallback findings extraction failed:`, err);
    return [];
  }
}
