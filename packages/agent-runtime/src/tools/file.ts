import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, dirname, resolve } from "path";
import type { NimToolDef } from "@nexsidi/llm-client";

export interface ToolResult {
  status: "success" | "error";
  summary: string;
  output?: string;
  next_actions?: string[];
}

// Guard: all file operations must stay within the sandbox output directory.
function guardPath(sandboxDir: string, relPath: string): string {
  const abs = resolve(join(sandboxDir, relPath));
  if (!abs.startsWith(resolve(sandboxDir))) {
    throw new Error(`Path traversal blocked: "${relPath}" escapes sandbox`);
  }
  return abs;
}

export function execWriteFile(sandboxDir: string, args: { path: string; content: string }): ToolResult {
  try {
    const abs = guardPath(sandboxDir, args.path);
    mkdirSync(dirname(abs), { recursive: true });
    // Full-system audit L2: some models send `content` as a JSON object
    // instead of a string (observed in stress-test run 7 — the same wrong
    // shape sent 5 times in a row, because writeFileSync's generic
    // TypeError taught the model nothing). Coercing here means the write
    // succeeds with reasonable content on the first attempt instead of
    // costing several more iterations to discover the fix.
    const content = typeof args.content === "string" ? args.content : JSON.stringify(args.content, null, 2);
    writeFileSync(abs, content, "utf-8");
    return {
      status: "success",
      summary: `Wrote ${content.length} chars to ${args.path}`,
      next_actions: ["run_command to verify (tsc, npm install, etc.)", "read_file to confirm content"],
    };
  } catch (err) {
    return {
      status: "error",
      summary: `write_file failed: ${String(err)}`,
      next_actions: ["check path for traversal", "verify content is valid UTF-8"],
    };
  }
}

// Phase B, L7 (full-system audit): agents rewrote whole files via write_file
// for single-line changes, burning output tokens re-emitting unchanged
// content. Mirrors Anthropic's own text-editor str_replace command — exactly
// one match required, otherwise it's an error the model can act on (add more
// surrounding context, or confirm it meant to touch every occurrence).
export function execEditFile(sandboxDir: string, args: { path: string; old_str: string; new_str: string }): ToolResult {
  try {
    const abs = guardPath(sandboxDir, args.path);
    if (!existsSync(abs)) {
      return { status: "error", summary: `File not found: ${args.path}`, next_actions: ["use list_files to see what exists", "use write_file to create a new file"] };
    }
    if (args.old_str === "") {
      return { status: "error", summary: "old_str must not be empty", next_actions: ["provide the exact text to replace"] };
    }
    const content = readFileSync(abs, "utf-8");
    const matches = content.split(args.old_str).length - 1;
    if (matches === 0) {
      return { status: "error", summary: `old_str not found in ${args.path}`, next_actions: ["read_file to see the exact current content", "match whitespace and indentation exactly"] };
    }
    if (matches > 1) {
      return { status: "error", summary: `old_str matches ${matches} times in ${args.path} — must match exactly once`, next_actions: ["add more surrounding lines to old_str to make it unique"] };
    }
    const updated = content.replace(args.old_str, args.new_str);
    writeFileSync(abs, updated, "utf-8");
    return { status: "success", summary: `Replaced 1 match in ${args.path}` };
  } catch (err) {
    return { status: "error", summary: `edit_file failed: ${String(err)}`, next_actions: ["check path for traversal"] };
  }
}

// Real 2026-07-07 stress-test bug: no delete_file tool existed. An agent
// needing to remove a wrongly-created file tried `rm` via run_command
// (blocked — not in command.ts's ALLOWED_COMMANDS), then burned ~15
// iterations on workarounds (node -e "fs.unlinkSync(...)", checking
// existence, writing placeholder content) instead of a direct tool call.
export function execDeleteFile(sandboxDir: string, args: { path: string }): ToolResult {
  try {
    const abs = guardPath(sandboxDir, args.path);
    if (!existsSync(abs)) {
      return { status: "error", summary: `File not found: ${args.path}`, next_actions: ["use list_files to see what exists"] };
    }
    unlinkSync(abs);
    return { status: "success", summary: `Deleted ${args.path}` };
  } catch (err) {
    return { status: "error", summary: `delete_file failed: ${String(err)}`, next_actions: ["check path for traversal"] };
  }
}

export function execReadFile(sandboxDir: string, args: { path: string; offset?: number; limit?: number }): ToolResult {
  try {
    const abs = guardPath(sandboxDir, args.path);
    if (!existsSync(abs)) {
      return { status: "error", summary: `File not found: ${args.path}`, next_actions: ["use list_files to see what exists"] };
    }
    let content = readFileSync(abs, "utf-8");
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 8000;
    if (offset > 0) content = content.slice(offset);
    if (content.length > limit) content = content.slice(0, limit) + `\n...[truncated, ${content.length - limit} more chars]`;
    return { status: "success", summary: `Read ${args.path}`, output: content };
  } catch (err) {
    return { status: "error", summary: `read_file failed: ${String(err)}`, next_actions: ["check path exists with list_files"] };
  }
}

export function execListFiles(sandboxDir: string, args: { dir?: string; recursive?: boolean }): ToolResult {
  try {
    const relDir = args.dir ?? ".";
    const abs = guardPath(sandboxDir, relDir);
    if (!existsSync(abs)) {
      return { status: "error", summary: `Directory not found: ${relDir}`, next_actions: ["create directory with write_file"] };
    }
    const files: string[] = [];
    function walk(dir: string, prefix = "") {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        const rel = join(prefix, entry);
        const stat = statSync(full);
        if (stat.isDirectory() && args.recursive) {
          walk(full, rel);
        } else {
          files.push(stat.isDirectory() ? rel + "/" : rel);
        }
      }
    }
    walk(abs, relDir === "." ? "" : relDir);
    return { status: "success", summary: `${files.length} entries in ${relDir}`, output: files.join("\n") };
  } catch (err) {
    return { status: "error", summary: `list_files failed: ${String(err)}` };
  }
}

export const FILE_TOOL_DEFS: NimToolDef[] = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file in the project output directory. Creates parent directories automatically. Use this to create ALL source files for the project.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root, e.g. 'src/routes/tasks.ts'" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the project output directory. Use to verify written files or read existing code.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          offset: { type: "number", description: "Character offset to start reading from (default 0)" },
          limit: { type: "number", description: "Max characters to return (default 8000)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace an exact, unique substring in an existing file — cheaper than write_file for small changes since it doesn't require re-emitting the whole file. old_str must match EXACTLY ONCE in the file (include enough surrounding lines to make it unique) or the call errors without modifying anything.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          old_str: { type: "string", description: "Exact text to find — must match exactly once in the file" },
          new_str: { type: "string", description: "Text to replace it with" },
        },
        required: ["path", "old_str", "new_str"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file in the project output directory. Use this instead of run_command('rm ...') — rm is not in the shell allowlist.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in a directory of the project. Use to understand the current file structure.",
      parameters: {
        type: "object",
        properties: {
          dir: { type: "string", description: "Relative directory path (default: '.' for project root)" },
          recursive: { type: "boolean", description: "List files recursively (default false)" },
        },
        required: [],
      },
    },
  },
];
