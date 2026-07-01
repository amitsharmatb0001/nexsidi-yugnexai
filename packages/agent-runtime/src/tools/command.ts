import { spawnSync } from "child_process";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

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
  const [cmd, ...rest] = command.trim().split(/\s+/);
  if (!ALLOWED_COMMANDS.has(cmd)) return `Command '${cmd}' is not in the allowlist`;
  if (cmd === "pkill") {
    const target = rest.find(a => !a.startsWith("-"));
    if (target && !PKILL_ALLOWED_TARGETS.has(target)) return `pkill target '${target}' not allowed`;
  }
  if (cmd === "chmod") {
    const mode = rest[0];
    if (mode && !/^[ugoa]*\+x$/.test(mode)) return `chmod mode '${mode}' not allowed — only +x variants permitted`;
  }
  return null;
}

export function execRunCommand(
  cwd: string,
  args: { command: string; timeout_ms?: number },
): ToolResult {
  const parts = args.command.trim().split(/\s+/);
  const [cmd, ...cmdArgs] = parts;

  const validationError = validateCommand(args.command);
  if (validationError) {
    return {
      status: "error",
      summary: `Command blocked: ${validationError}`,
      next_actions: ["Use only allowlisted commands: npm, npx, bun, tsc, node, git, ls, cat"],
    };
  }

  const timeout = Math.min(args.timeout_ms ?? 120_000, 300_000);

  try {
    const result = spawnSync(cmd, cmdArgs, {
      cwd,
      encoding: "utf-8",
      timeout,
      env: { ...process.env, FORCE_COLOR: "0", NPM_CONFIG_FUND: "false", NPM_CONFIG_AUDIT: "false" },
    });

    const stdout = (result.stdout ?? "").slice(0, 6000);
    const stderr = (result.stderr ?? "").slice(0, 6000);
    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    const success = result.status === 0;

    return {
      status: success ? "success" : "error",
      summary: success
        ? `'${args.command}' exited 0`
        : `'${args.command}' exited ${result.status ?? "timeout"}`,
      output: combined || "(no output)",
      next_actions: success
        ? []
        : ["Read the output above carefully", "Fix the specific error mentioned", "Re-run the command"],
    };
  } catch (err) {
    return {
      status: "error",
      summary: `run_command threw: ${String(err)}`,
      next_actions: ["Check if the command exists", "Verify the working directory is correct"],
    };
  }
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
