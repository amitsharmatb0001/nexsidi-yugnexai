// Read-only shell commands built into run_command (3 Oct 2026). The worker
// runs from PowerShell, where Git's usr\bin (cat, ls, head, tail, wc) is not
// on PATH, so `cat app/not-found.tsx` — one of the frontend's required checks
// — failed although the file existed (Ledgerly benchmark runs 2–4). These
// behave the same on every machine. Paths have already passed the folder
// check (ownership.ts) before they reach here.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolResult } from "./file.ts";

const BUILTINS = new Set(["cat", "ls", "head", "tail", "wc", "pwd"]);

function fail(command: string, output: string): ToolResult {
  return { status: "error", summary: `'${command}' exited 1`, output };
}

function ok(command: string, output: string): ToolResult {
  return { status: "success", summary: `'${command}' exited 0`, output: output || "(no output)" };
}

function readText(cwd: string, file: string): string | null {
  const p = resolve(cwd, file);
  if (!existsSync(p) || statSync(p).isDirectory()) return null;
  return readFileSync(p, "utf-8");
}

/** Count from "-n 5", "-n5" or "-5"; files are the remaining arguments. */
function countAndFiles(args: string[], fallback: number): { n: number; files: string[] } | null {
  let n = fallback;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-n") { n = Number(args[++i]); continue; }
    if (/^-n\d+$/.test(a)) { n = Number(a.slice(2)); continue; }
    if (/^-\d+$/.test(a)) { n = Number(a.slice(1)); continue; }
    if (a.startsWith("-")) return null; // an option we do not emulate
    files.push(a);
  }
  return Number.isFinite(n) ? { n, files } : null;
}

/**
 * Runs cat/ls/head/tail/wc/pwd in-process. Returns null for anything else,
 * or for options these do not handle (the caller then spawns the real one).
 */
export function runBuiltinCommand(command: string, cmd: string, args: string[], cwd: string): ToolResult | null {
  if (!BUILTINS.has(cmd)) return null;

  if (cmd === "pwd") return args.length ? null : ok(command, resolve(cwd));

  if (cmd === "cat") {
    if (args.some((a) => a.startsWith("-"))) return null;
    if (args.length === 0) return fail(command, "cat: no file given");
    const parts: string[] = [];
    for (const f of args) {
      const text = readText(cwd, f);
      if (text === null) return fail(command, `cat: ${f}: No such file or directory`);
      parts.push(text);
    }
    return ok(command, parts.join(""));
  }

  if (cmd === "ls") {
    const flags = args.filter((a) => a.startsWith("-")).join("").replace(/-/g, "");
    if (/[^la1]/.test(flags)) return null;
    const targets = args.filter((a) => !a.startsWith("-"));
    const lines: string[] = [];
    for (const t of targets.length ? targets : ["."]) {
      const p = resolve(cwd, t);
      if (!existsSync(p)) return fail(command, `ls: cannot access '${t}': No such file or directory`);
      if (!statSync(p).isDirectory()) { lines.push(t); continue; }
      const names = readdirSync(p).filter((n) => flags.includes("a") || !n.startsWith(".")).sort();
      if (targets.length > 1) lines.push(`${t}:`);
      lines.push(...names.map((n) => (statSync(resolve(p, n)).isDirectory() ? `${n}/` : n)));
    }
    return ok(command, lines.join("\n"));
  }

  if (cmd === "head" || cmd === "tail") {
    const parsed = countAndFiles(args, 10);
    if (!parsed || parsed.files.length !== 1) return parsed ? fail(command, `${cmd}: give exactly one file`) : null;
    const text = readText(cwd, parsed.files[0]!);
    if (text === null) return fail(command, `${cmd}: cannot open '${parsed.files[0]}': No such file or directory`);
    const lines = text.replace(/\n$/, "").split("\n");
    return ok(command, (cmd === "head" ? lines.slice(0, parsed.n) : lines.slice(-parsed.n)).join("\n"));
  }

  // wc: -l only (the common use)
  if (args[0] !== "-l" || args.length < 2) return null;
  const out: string[] = [];
  for (const f of args.slice(1)) {
    const text = readText(cwd, f);
    if (text === null) return fail(command, `wc: ${f}: No such file or directory`);
    out.push(`${(text.match(/\n/g) ?? []).length} ${f}`);
  }
  return ok(command, out.join("\n"));
}
