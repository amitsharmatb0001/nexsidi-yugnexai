import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, dirname, resolve } from "path";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { EvidenceLedger } from "../enforce/evidence.ts";
import { rollbackWorkspaceTransaction } from "./git.ts";
import { findSymbolInFile } from "../compaction.ts";

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

export function cleanComposeContent(filePath: string, content: string): string {
  const filename = filePath.split(/[/\\]/).pop();
  if (filename === "docker-compose.yml" || filename === "docker-compose.yaml") {
    const cleaned = content
      .split("\n")
      .filter((line) => !/^\s*container_name\s*:\s*/.test(line))
      .join("\n");
    if (cleaned !== content) {
      console.log(`[file] Sanitized container_name from ${filePath} to prevent naming conflicts.`);
      return cleaned;
    }
  }
  return content;
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
    let content = typeof args.content === "string" ? args.content : JSON.stringify(args.content, null, 2);
    content = cleanComposeContent(args.path, content);
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

// 2026-07-25 (Phase 2.3, full MVP upgrade): batch write. Root cause of the
// 40-iteration grind (audit-2026-07-25.md): write_file takes exactly one
// path+content, and with the pre-Phase-0 16K output cap a model could only
// fit 1-2 files per turn regardless of instructions — a 15-file site needed
// ~30 write turns before any verification even started. Now that Phase 0
// raised the real output ceiling to 64K, one turn can legitimately hold
// several files' worth of content; write_files lets the model actually use
// that budget instead of being forced back into one-call-per-file by the
// tool shape itself. Each file is written independently via execWriteFile —
// a failure on file N does not roll back files 1..N-1 (they already exist on
// disk); the per-file result array tells the caller exactly which failed.
export function execWriteFiles(sandboxDir: string, args: { files: Array<{ path: string; content: string }> }): ToolResult {
  if (!Array.isArray(args.files) || args.files.length === 0) {
    return { status: "error", summary: "write_files requires a non-empty files array", next_actions: ["pass at least one {path, content} entry"] };
  }
  const results = args.files.map((f) => ({ path: f.path, ...execWriteFile(sandboxDir, f) }));
  const failed = results.filter((r) => r.status === "error");
  if (failed.length > 0) {
    return {
      status: "error",
      summary: `write_files: ${results.length - failed.length}/${results.length} succeeded, ${failed.length} failed`,
      output: failed.map((f) => `${f.path}: ${f.summary}`).join("\n"),
      next_actions: ["retry the failed paths individually with write_file", "check each failed path for traversal or invalid content"],
    };
  }
  return {
    status: "success",
    summary: `Wrote ${results.length} files: ${results.map((r) => r.path).join(", ")}`,
    next_actions: ["run_command to verify (tsc, npm install, etc.)"],
  };
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
    const finalContent = cleanComposeContent(args.path, updated);
    writeFileSync(abs, finalContent, "utf-8");
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

export function execRollbackWorkspace(sandboxDir: string): ToolResult {
  try {
    rollbackWorkspaceTransaction(sandboxDir);
    return {
      status: "success",
      summary: "Successfully rolled back workspace to the last stable transaction checkpoint.",
    };
  } catch (err) {
    return {
      status: "error",
      summary: `rollback_workspace failed: ${String(err)}`,
    };
  }
}

export function execQuerySymbol(sandboxDir: string, args: { path: string; symbol: string }): ToolResult {
  try {
    const abs = guardPath(sandboxDir, args.path);
    const output = findSymbolInFile(abs, args.symbol);
    return {
      status: "success",
      summary: `Queried symbol "${args.symbol}" in ${args.path}`,
      output,
    };
  } catch (err) {
    return {
      status: "error",
      summary: `query_symbol failed: ${String(err)}`,
    };
  }
}

// Phase 5 Task 2: ledger is optional — see execRunCommand's identical note.
export function execReadFile(sandboxDir: string, args: { path: string; offset?: number; limit?: number }, ledger?: EvidenceLedger): ToolResult {
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
    ledger?.record("file_read", args.path);
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
      name: "write_files",
      description: "Write MULTIPLE files in a single call — PREFER THIS over repeated write_file calls whenever you already know several files' full content (e.g. from a locked build plan). Batching several files per turn is what your real output budget is for; writing one file per turn wastes iterations re-deciding what to write next when you already know.",
      parameters: {
        type: "object",
        properties: {
          files: {
            type: "array",
            description: "List of files to write in this one call",
            items: {
              type: "object",
              properties: {
                path: { type: "string", description: "Relative path from project root, e.g. 'src/routes/tasks.ts'" },
                content: { type: "string", description: "Full file content to write" },
              },
              required: ["path", "content"],
            },
          },
        },
        required: ["files"],
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
  {
    type: "function",
    function: {
      name: "rollback_workspace",
      description: "Discard all changes made to files in the workspace since the last stable checkpoint. Use this when compilation is broken or tests are failing and you want to start fresh from a clean state.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_symbol",
      description: "Find and read the exact implementation/declaration of a class, function, interface, or type in a file without loading the entire file content. Use this to save token context.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          symbol: { type: "string", description: "The name of the class, function, interface, or type to locate" },
        },
        required: ["path", "symbol"],
      },
    },
  },
];
