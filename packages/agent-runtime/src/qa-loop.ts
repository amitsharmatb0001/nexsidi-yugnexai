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
  geminiChat,
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
import { compactGeminiHistory, estimateGeminiTokenCount } from "./compaction.ts";
// 2026-08-13 (cost-control Task 1): same CRITICAL gap as loop.ts/
// gemini-loop.ts/claude-loop.ts — and this file's own header comment records
// the live incident that makes it the MOST important of the four to close
// ("a single QA round ... ran to ~7.8M tokens").
import { recordSpend } from "./cost-budget.ts";

// 2026-07-24 (W0.3): this loop previously had NO compaction at all. 2026-
// 07-25 (Phase 0.3): matches gemini-loop.ts's threshold — 40K was 4% of the
// documented 1M input window for every provisioned model (gemini_3_1_pro.md
// etc., E:/ai yug/), amnesiac far too early for a 30-iteration exploration.
const QA_COMPACTION_THRESHOLD_TOKENS = 750_000;

export { detectStuckLoop };

export const QA_MAX_ITERATIONS = 30;

// 2026-07-26 (agent-autonomy-assessment root-cause, follow-on): full
// coverage (checkReviewCoverage) now requires reading every listed file —
// a flat 30-iteration cap made that structurally impossible on a
// real-size project. Budget: one iteration per file read, plus list_files
// (1), submit_findings (1), and slack for re-reads/thinking-only turns
// (10) — floored at the original QA_MAX_ITERATIONS so small projects are
// unaffected.
export function computeQaMaxIterations(totalFiles: number): number {
  return Math.max(QA_MAX_ITERATIONS, totalFiles + 12);
}

// 2026-08-05: real bug found live (project 09bf2f89ca43) — a one-shot
// extraction call that replays an agent's full conversation (including its
// original system prompt, which mandates core-reasoning.md's Rule 0
// <thinking> block) gets that block back even when its own instruction says
// "no formatting, output only JSON". Strips a leading <thinking>...</thinking>
// block (and the whitespace around it) so callers can JSON.parse what's
// left — mirrors the same tag gemini-loop.ts/claude-loop.ts/loop.ts already
// extract for logging, but removes it instead of just reading it.
export function stripThinkingBlock(text: string): string {
  return text.replace(/^\s*<thinking>[\s\S]*?<\/thinking>\s*/, "");
}

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
  // F5 (agent-autonomy-assessment): the spec/API-contract/DB-schema this
  // codebase is supposed to implement — a plain rendered string (not a
  // BuildPlan type) so this package never depends on agents/arjun. Callers
  // build it with arjun's buildSystemContext(plan). Optional so existing
  // callers/tests keep working unchanged.
  systemContext?: string;
  // 2026-08-13 (cost-control Task 1): this loop's own header comment
  // documents a real live cost incident — "a single QA round ... ran to
  // ~7.8M tokens" — yet had no way to attribute that spend to a project at
  // all (no projectId field existed here before this task). Optional so
  // existing callers/tests keep working unchanged; navya/karan/deepika's
  // runExploring() already receive projectId as their own first parameter
  // and now thread it through here.
  projectId?: string;
}

export interface QAAgentResult {
  findings: Finding[];
  iterations: number;
  errors: string[];
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sql", ".prisma", ".json", ".yaml", ".yml", ".css", ".scss", ".html", ".md"]);
// 2026-07-28 (live, complex1): "vendor" added — see listLabeledFiles' test
// header comment. A vendored third-party library folder is static, not
// project code, and re-reading it every round to satisfy full coverage was
// the dominant cost behind a real 35+ minute live-retest wall-clock.
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "vendor"]);
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

// 2026-08-03: real cost problem found live — a single QA round (Navya/Karan/
// Deepika, each reading dozens of files one at a time via read_file) ran to
// ~7.8M tokens, because every read_file call is a full round-trip that
// resends the ENTIRE growing conversation history as input. Batching several
// files into ONE call cuts the round-trip count (and therefore the number of
// times history gets resent) without reducing coverage — pure logic
// extracted so it's directly testable without mocking the LLM loop, matching
// this file's own convention (detectStuckLoop, checkReviewCoverage, etc.).
export interface ReadLabeledFilesResult {
  output: string;
  readPaths: string[];
}

export function readLabeledFiles(dirs: LabeledDir[], paths: string[]): ReadLabeledFilesResult {
  const chunks: string[] = [];
  const readPaths: string[] = [];
  for (const path of paths) {
    const abs = path ? resolveLabeledFile(dirs, path) : null;
    if (!abs || !existsSync(abs)) {
      chunks.push(`// FILE: ${path}\n[not found — use list_files to see valid paths]`);
      continue;
    }
    try {
      let content = readFileSync(abs, "utf-8");
      if (content.length > READ_FILE_CHAR_LIMIT) {
        content = content.slice(0, READ_FILE_CHAR_LIMIT) + `\n...[truncated, ${content.length - READ_FILE_CHAR_LIMIT} more chars]`;
      }
      readPaths.push(path);
      chunks.push(`// FILE: ${path}\n${content}`);
    } catch (err) {
      chunks.push(`// FILE: ${path}\n[read failed: ${String(err)}]`);
    }
  }
  return { output: chunks.join("\n\n"), readPaths };
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
      description: "Read a file by its labeled path (from list_files' output, e.g. 'backend/src/controllers/tasks.ts'). You MUST read a file before citing it in a finding — findings citing an unread file are rejected. Prefer read_files when you need more than one file — it costs one iteration instead of several.",
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
      name: "read_files",
      description: "Read MULTIPLE files by their labeled paths in a single call — costs one iteration (and one round of resent history) instead of one per file. Use this instead of repeated read_file calls whenever you already know several files you need (e.g. right after list_files). Each file's content is returned separately, clearly delimited.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Labeled paths from list_files — batch as many as you reasonably need (3-10 at a time is typical).",
          },
        },
        required: ["paths"],
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

// Pure/testable — see qa-loop.test.ts for the live evidence this closes
// (F5, agent-autonomy-assessment): QA reviewing code with no spec/contract/
// schema re-flagged the same false-positive finding every round because it
// had no way to judge scale/intent, and could never report "this doesn't
// match what was asked for."
export function buildQaInitialMessage(reviewFocus: string, systemContext: string | undefined): string {
  const contextBlock = systemContext ? `${systemContext}\n\n` : "";
  return (
    `${contextBlock}Review this codebase for ${reviewFocus}. Call list_files first to see every file, then ` +
    `read EVERY file listed — submit_findings will be rejected until you have read all of them, not a ` +
    `sample. Use read_files to batch several files (3-10) per call instead of read_file one at a time — each ` +
    `call costs a full round-trip of resent history, so batching cuts cost and iterations substantially with ` +
    `no loss of coverage. A file you haven't opened may hold the most serious issue; reading most of the ` +
    `codebase and concluding "clean" is exactly how real bugs go unreported. You must read a file before you ` +
    `can cite it in a finding. Call submit_findings when done (empty findings array if you found nothing).`
  );
}

export async function runQAAgent(config: QAAgentConfig): Promise<QAAgentResult> {
  const tools: GeminiToolDef[] = QA_TOOL_DEFS.map(translateNimToolToGeminiTool);
  const systemPrompt = assembleSystemPrompt({ agentName: config.agentName, basePrompt: config.systemPrompt });

  let messages: GeminiMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: buildQaInitialMessage(config.reviewFocus, config.systemContext),
    },
  ];

  const readFiles = new Set<string>();
  const errors: string[] = [];
  const recentCallSignatures: string[] = [];
  let iterations = 0;
  // Computed upfront (not lazily on the first list_files call) since the
  // iteration cap must scale with the real file count from the start —
  // see computeQaMaxIterations.
  let totalFilesListed = listLabeledFiles(config.dirs).length;
  const effectiveMaxIterations = computeQaMaxIterations(totalFilesListed);

  while (iterations < effectiveMaxIterations) {
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
      // 2026-07-28: agentName rotates each agent's FALLBACK order so
      // Navya/Karan/Deepika (genuinely parallel, per CLAUDE.md's own
      // "different models = 120 RPM effective capacity" design) don't all
      // collide on the SAME fallback model's shared rate limit when the
      // pool's shared primary is exhausted — see rotatedPoolForAgent.
      response = await routeToolsWithFallback("qa", messages, tools, { agentName: config.agentName });
      if (iterations === 1) {
        console.log(`[${config.agentName}:qa-loop] model=${response.modelUsed}`);
      }
      // 2026-08-13 (cost-control Task 1): real per-project $ accumulation —
      // see this file's recordSpend import comment.
      if (config.projectId) {
        try {
          await recordSpend(
            config.projectId,
            response.promptTokens ?? estimateGeminiTokenCount(messages),
            response.completionTokens ?? 300,
            response.modelUsed,
          );
        } catch (spendErr) {
          console.error(`[${config.agentName}:qa-loop] recordSpend failed (non-fatal — this call's spend may be under-counted):`, spendErr);
        }
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
        const fallbackFindings = await extractFindingsFromHistory(messages, config.agentName, readFiles, errors);
        return { findings: fallbackFindings, iterations, errors };
      }
      continue;
    }

    const turnSignature = response.toolCalls.map((c) => `${c.name}:${JSON.stringify(c.input)}`).join("|");
    recentCallSignatures.push(turnSignature);
    if (detectStuckLoop(recentCallSignatures)) {
      const reason = `Stuck: ${config.agentName} repeated the identical tool call (${turnSignature.slice(0, 150)}) 3 turns in a row with no progress — stopped early instead of grinding to the ${effectiveMaxIterations}-iteration cap.`;
      console.log(`[${config.agentName}:qa-loop] ${reason}`);
      errors.push(reason);
      const fallbackFindings = await extractFindingsFromHistory(messages, config.agentName, readFiles, errors);
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
        case "read_files": {
          const paths = (call.input as { paths?: string[] }).paths ?? [];
          const { output, readPaths } = readLabeledFiles(config.dirs, paths);
          for (const path of readPaths) readFiles.add(path);
          result = { status: "success", summary: `Read ${paths.length} file(s)`, output };
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
  const fallbackFindings = await extractFindingsFromHistory(messages, config.agentName, readFiles, errors);
  return { findings: fallbackFindings, iterations, errors };
}

export async function extractFindingsFromHistory(
  messages: GeminiMessage[],
  agentName: string,
  readFiles: ReadonlySet<string>,
  errors: string[],
  chat: typeof geminiChat = geminiChat,
): Promise<Finding[]> {
  // 2026-08-06: real bug found live (project 88d7b375eaef) — a genuinely
  // truncated/malformed LLM response here (JSON.parse "Unexpected EOF", not
  // the <thinking>-wrapping case stripThinkingBlock already fixes) hit the
  // catch below and silently returned [], which is INDISTINGUISHABLE from a
  // real "agent reviewed the code and found nothing" outcome once it reaches
  // Navya/Karan/Deepika's wrapper — a QA integrity hole for a gate whose
  // entire job is catching real bugs. One retry (same "retry once on
  // empty/unparseable" convention as Saanvi/Arjun/Vanya) before giving up;
  // on a second failure, push into `errors` instead of swallowing — the
  // three QA wrappers' existing hasFatalError check already turns a non-
  // benign errors[] entry into a synthetic "review did not complete"
  // CRITICAL finding, so this makes extraction failure visibly block the
  // gate instead of quietly passing it.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await attemptExtraction(messages, agentName, readFiles, chat);
    } catch (err) {
      if (attempt === 2) {
        const msg = `[${agentName}] fallback findings extraction failed after retry: ${String(err)}`;
        console.error(msg);
        errors.push(msg);
        return [];
      }
      console.error(`[qa-loop] Fallback findings extraction failed (attempt ${attempt}) — retrying once:`, err);
    }
  }
  return [];
}

async function attemptExtraction(
  messages: GeminiMessage[],
  agentName: string,
  readFiles: ReadonlySet<string>,
  chat: typeof geminiChat,
): Promise<Finding[]> {
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

    const response = await chat(chatMessages);
    // 2026-08-05: real bug found live (project 09bf2f89ca43) — this call
    // replays the FULL original QA agent conversation, including its
    // system-prompt role message (see the loop above: `if (m.role ===
    // "system") chatMessages.push(...)`) — which carries core-reasoning.md's
    // Rule 0 ("If you do not output a <thinking> block, the system will
    // reject your completion"). The model dutifully wraps its JSON response
    // in a <thinking> block despite this prompt's own "no formatting"
    // instruction, and only markdown-fence stripping was handled here —
    // JSON.parse threw on the leading "<", was swallowed by the catch below,
    // and silently returned [] instead of whatever findings the agent
    // actually reported. stripThinkingBlock mirrors the same extraction
    // gemini-loop.ts/claude-loop.ts/loop.ts already use for logging, applied
    // here to actually remove it before parsing.
  const trimmed = stripThinkingBlock(response.content.trim()).trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  const cleanJsonText = fenceMatch ? fenceMatch[1]! : trimmed;
  const parsed = JSON.parse(cleanJsonText) as { findings?: Finding[] };
  const extracted = parsed.findings ?? [];

  return extracted.filter(f => !f.file || readFiles.has(f.file));
}
