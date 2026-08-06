import { spawn } from "child_process";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";
import type { EvidenceLedger } from "../enforce/evidence.ts";
import { buildSandboxEnv } from "./sandbox-env.ts";

// Command allowlist — from nexsidi-sandbox skill (Anthropic autonomous-coding baseline)
const ALLOWED_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "wc", "grep",
  "cp", "mkdir", "chmod",
  "pwd",
  "npm", "node", "npx", "bun",
  "git",
  "ps", "lsof", "sleep", "pkill",
  "tsc", "next",
  "curl",                       // for health-check fallback inside container
]);

const PKILL_ALLOWED_TARGETS = new Set(["node", "npm", "npx", "bun", "next", "vite"]);

function validateCommand(command: string): string | null {
  if (!command.trim()) return "Empty command";
  // Block compound operators that bypass allowlist
  if (/&&|\|\||;/.test(command)) return "Compound commands are not allowed — call run_command once per command";
  const rest = command.trim().split(/\s+/);
  const cmd = rest[0];
  if (!cmd || !ALLOWED_COMMANDS.has(cmd)) return `Command '${cmd || ""}' is not in the allowlist`;
  if (cmd === "pkill") {
    const target = rest.slice(1).find(a => !a.startsWith("-"));
    if (target && !PKILL_ALLOWED_TARGETS.has(target)) return `pkill target '${target}' not allowed`;
  }
  if (cmd === "chmod") {
    const mode = rest[1];
    if (mode && !/^[ugoa]*\+x$/.test(mode)) return `chmod mode '${mode}' not allowed — only +x variants permitted`;
  }
  return null;
}

// Full-system audit TO1: real build-tool errors (npm ERESOLVE conflicts,
// "Failed to compile" from next build) sit at the END of long output, but
// the previous slice(0, 6000) kept only the HEAD — agents saw progress
// noise and never the actual failure, then blindly re-ran the same
// command repeatedly (observed in stress-test runs 8/9/10). Keeps a small
// head for command-invocation context plus the tail where errors live.
export function truncateOutput(text: string, headChars: number, tailChars: number): string {
  if (text.length <= headChars + tailChars) return text;
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  return `${head}\n...[truncated ${text.length - headChars - tailChars} chars]...\n${tail}`;
}

export function resolveCommandExecutable(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" && ["npm", "npx", "tsc", "next"].includes(command)
    ? `${command}.cmd`
    : command;
}

// 2026-08-06: real bug found live (project d749afe43d9c, via
// packages/agent-runtime/src/tools/docker.ts's identical fix, commit
// fe3f2ab) — this used spawnSync, which blocks Node's ENTIRE event loop for
// the full child-process duration. This is the SINGLE execution path shared
// by every agent (Shubham, Aanya, Pranav, Riya, Navya, Karan, Deepika) via
// the "run_command" tool case in loop.ts/gemini-loop.ts/claude-loop.ts — a
// slow npm install, a large tsc --noEmit, or a long build (some already use
// timeout_ms up to 120000ms, close to genAct's 3-minute heartbeatTimeout in
// pipeline/workflows/project-build.ts) risked the exact same failure chain
// docker.ts's comment traces in full: blocked event loop -> missed
// heartbeat -> Temporal times out and retries the activity -> the retry's
// context-chain re-verification sees a manifest already modified by
// attempt 1's still-running blocked call -> a false-positive hash mismatch
// that rollbackAndEscalate treats as tampering and kills the whole
// workflow, while the original blocked call keeps running as an orphan.
// Converted to async spawn (event-based stdout/stderr accumulation, SIGKILL
// on timeout) for the same reason and via the same pattern as docker.ts.
//
// Phase 5 Task 2: ledger is optional so existing call sites (loop.ts,
// claude-loop.ts, gemini-loop.ts, and every pre-existing test) keep
// compiling and passing unchanged. Only a SUCCESSFUL run is evidence — a
// failed command is debugging information, not proof of anything working.
export function execRunCommand(
  cwd: string,
  args: { command: string; timeout_ms?: number },
  ledger?: EvidenceLedger,
): Promise<ToolResult> {
  const parts = args.command.trim().split(/\s+/);
  const cmd = parts[0];
  if (!cmd) {
    return Promise.resolve({ status: "error", summary: "Empty command" });
  }
  const cmdArgs = parts.slice(1);

  const validationError = validateCommand(args.command);
  if (validationError) {
    return Promise.resolve({
      status: "error",
      summary: `Command blocked: ${validationError}`,
      next_actions: ["Use only allowlisted commands: npm, npx, bun, tsc, node, git, ls, cat"],
    });
  }

  const timeout = Math.min(args.timeout_ms ?? 120_000, 300_000);

  return new Promise<ToolResult>((resolve) => {
    let child;
    try {
      child = spawn(resolveCommandExecutable(cmd), cmdArgs, {
        cwd,
        env: buildSandboxEnv({ FORCE_COLOR: "0", NPM_CONFIG_FUND: "false", NPM_CONFIG_AUDIT: "false" }),
      });
    } catch (err) {
      resolve({
        status: "error",
        summary: `run_command threw: ${String(err)}`,
        next_actions: ["Check if the command exists", "Verify the working directory is correct"],
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError: unknown;
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);

    child.on("error", (err) => {
      spawnError = err;
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (spawnError) {
        resolve({
          status: "error",
          summary: `run_command threw: ${String(spawnError)}`,
          next_actions: ["Check if the command exists", "Verify the working directory is correct"],
        });
        return;
      }

      const truncStdout = truncateOutput(stdout, 1000, 5000);
      const truncStderr = truncateOutput(stderr, 1000, 5000);
      const combined = [truncStdout, truncStderr].filter(Boolean).join("\n").trim();
      const success = !timedOut && code === 0;

      if (success) ledger?.record("command_output", `${args.command} -> exited 0`);

      resolve({
        status: success ? "success" : "error",
        summary: success
          ? `'${args.command}' exited 0`
          : `'${args.command}' exited ${timedOut ? "timeout" : code}`,
        output: combined || "(no output)",
        next_actions: success
          ? []
          : ["Read the output above carefully", "Fix the specific error mentioned", "Re-run the command"],
      });
    });
  });
}

export const COMMAND_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "run_command",
    description: "Run a shell command in the project output directory. Use for: npm install, tsc --noEmit, npx next build, etc. One command per call — no pipes or &&. Read the output carefully.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Full command string e.g. 'npm install' or 'npx tsc --noEmit'" },
        timeout_ms: { type: "number", description: "Timeout in milliseconds (default 120000, max 300000)" },
      },
      required: ["command"],
    },
  },
};
