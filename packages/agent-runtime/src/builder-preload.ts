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

export function buildOwnFilesPreload(root: string, budgetChars = BUILDER_PRELOAD_CHARS): OwnFilesPreload {
  const files: string[] = [];
  const walk = (rel: string) => {
    let names: string[];
    try {
      names = readdirSync(join(root, rel));
    } catch {
      return;
    }
    for (const n of names) {
      if (SKIP.has(n) || SKIP_FILES.has(n)) continue;
      const r = rel ? `${rel}/${n}` : n;
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
export function ownFilesSection(root: string): string {
  const p = buildOwnFilesPreload(root);
  if (p.included.length === 0) return "";
  const rest = p.omitted.length ? `\nNot included (read them with read_files when you need them): ${p.omitted.join(", ")}` : "";
  return (
    `\n\nYOUR CURRENT FILES — ${p.included.length} file(s) you already wrote, whole, as they are on disk right now. Do not ` +
    `read these again with read_file/read_files unless you changed them in this run; work from this copy.${rest}\n\n${p.text}`
  );
}
