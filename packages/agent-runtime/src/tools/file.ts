import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "fs";
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
    writeFileSync(abs, args.content, "utf-8");
    return {
      status: "success",
      summary: `Wrote ${args.content.length} chars to ${args.path}`,
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
