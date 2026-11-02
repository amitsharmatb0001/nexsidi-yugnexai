// A builder's own files in its first message (2026-10-23). On the Brewline build the frontend builder read its own files one
// at a time — 131 of its 317 model calls — and every call resent the whole conversation. When a builder works on files that
// already exist (a later phase, a fix round) they go into its first message instead, whole, up to a budget; that message is
// also a stable start of the conversation, which is what the model's prompt cache rewards. Files past the budget are listed
// for read_files.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", ".nexsidi", "logs", "review", "coverage"]);
const CODE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".sql", ".md", ".yml", ".yaml"]);
const SKIP_FILES = new Set(["package-lock.json", "bun.lock", "bun.lockb", "yarn.lock", "pnpm-lock.yaml", "tsconfig.tsbuildinfo"]);

export const BUILDER_PRELOAD_CHARS = Number(process.env.BUILDER_PRELOAD_CHARS ?? 300_000);

export interface OwnFilesPreload {
  text: string;
  included: string[];
  omitted: string[];
}

const FILES_HEADING = "\n\nYOUR CURRENT FILES — ";
// Two copies of a task are the same when they start the same: the file list and the plan differ only further on.
const SAME_TASK_CHARS = 400;

function withoutFiles(text: string): string {
  const at = text.indexOf(FILES_HEADING);
  return at < 0 ? text : text.slice(0, at);
}

/**
 * 2026-11-02 (Brewline 7): every restart of a step added its whole task and files again: one helper's conversation held four copies,
 * 360K characters, resent on every call. On a restart, older copies of the files are out of date, and an older copy of the same task
 * says nothing the new one does not.
 */
export function withoutOldCopies<T extends { role: string; content: unknown }>(messages: T[], task: string): T[] {
  const same = withoutFiles(task).slice(0, SAME_TASK_CHARS);
  return messages.map((m) => {
    if (m.role !== "user" || typeof m.content !== "string") return m;
    const kept = withoutFiles(m.content);
    if (kept.slice(0, SAME_TASK_CHARS) === same) return { ...m, content: "(An earlier copy of your task was here; the current one comes later.)" };
    return kept === m.content ? m : { ...m, content: kept };
  });
}

export function buildOwnFilesPreload(root: string, budgetChars = BUILDER_PRELOAD_CHARS, skip: string[] = []): OwnFilesPreload {
  const leaveOut = new Set(skip.flatMap((f) => [f, f.replace(/\.(tsx?|jsx?)$/, ".test.$1")]));
  const files: string[] = [];
  const walk = (rel: string) => {
    let names: string[];
    try {
      names = readdirSync(join(root, rel));
    } catch {
      return;
    }
    for (const n of names) {
      // Compiled output under any name (a builder made dist-test and dist-test-2 for itself).
      if (SKIP.has(n) || SKIP_FILES.has(n) || n.startsWith("dist")) continue;
      const r = rel ? `${rel}/${n}` : n;
      if (leaveOut.has(r)) continue;
      try {
        if (statSync(join(root, r)).isDirectory()) walk(r);
        else if (CODE.has(extname(n)) || n === ".env.example") files.push(r);
      } catch {
        // unreadable: skipped
      }
    }
  };
  walk("");
  const included: string[] = [];
  const omitted: string[] = [];
  const parts: string[] = [];
  let used = 0;
  for (const f of files.sort()) {
    let body: string;
    try {
      body = readFileSync(join(root, f), "utf-8");
    } catch {
      omitted.push(f);
      continue;
    }
    const block = `=== FILE: ${f} ===\n${body}\n=== END: ${f} ===`;
    if (used + block.length > budgetChars) {
      omitted.push(f);
      continue;
    }
    parts.push(block);
    included.push(f);
    used += block.length;
  }
  return { text: parts.join("\n\n"), included, omitted };
}

/** The first-message section for a builder whose files already exist. "" when there is nothing to preload. */
export function ownFilesSection(root: string, skip: string[] = []): string {
  const p = buildOwnFilesPreload(root, BUILDER_PRELOAD_CHARS, skip);
  if (p.included.length === 0) return "";
  const rest = p.omitted.length ? `\nNot included (read them with read_files when you need them): ${p.omitted.join(", ")}` : "";
  return (
    `${FILES_HEADING}${p.included.length} file(s) you already wrote, whole, as they are on disk right now. Do not ` +
    `read these again with read_file/read_files unless you changed them in this run; work from this copy.${rest}\n\n${p.text}`
  );
}
