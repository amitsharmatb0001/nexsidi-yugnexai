// Ownership — every agent does only its own work (approved by Amit,
// 2 Oct 2026). Each agent's tools are confined to its own folder; only
// Tilotma works from the whole project. Found live in Ledgerly benchmark
// run 2: the frontend builder read ../backend and ../db with its own node
// scripts, and its compose file built ../backend and mounted
// ../db/migrations. Earlier runs left restart_backend.js and fix_cors.js.
// Prompts alone did not stop it, so the boundary is enforced here.
import { isAbsolute, resolve, sep } from "node:path";

/** Which files inside its folder an agent may change, by path relative to the folder ("/" separators). */
export type WritableFile = (relPath: string) => boolean;

export const NOT_YOUR_FILE_HINT =
  "You may only change your own files here. If the app itself is broken (a server error, a query or schema problem, a page that fails), it belongs to the builder that made it: call report_blocked with the owner (backend, frontend or database builder), the exact error and how to reproduce it, then finish your own job and say what failed.";

export function relativeInside(root: string, abs: string): string {
  return resolve(abs).slice(resolve(root).length).replace(/\\/g, "/").replace(/^\/+/, "");
}

export const OUTSIDE_FOLDER_HINT =
  "You may read every folder of the project (read_file, read_files, list_files, or ls, cat, head, tail, wc, grep), but you change and run only your own. If another folder's work is wrong, call report_blocked with the owner, what you need and what you checked, then continue with your own task.";

// 2026-10-29 (team plan, stage 1): commands that only read. With the project root among an agent's read-only folders they may name
// any file of the project; every other command (node, cp, npm, …) stays inside the agent's own folder.
const READ_ONLY_COMMANDS = new Set(["ls", "cat", "head", "tail", "wc", "grep"]);

function norm(p: string): string {
  const r = resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
}

/** True when `target` is `root` itself or inside it (a real folder boundary: backend-old is not inside backend). */
export function isInsideDir(root: string, target: string): boolean {
  const r = norm(root);
  const t = norm(target);
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep);
}

// A plain path token: no spaces, quotes, brackets or other code characters.
const PATH_LIKE = /^[\w.\-~:@\\/+]+$/;

/** The arguments that name a file or folder outside `cwd`. Flags, URLs and inline code are ignored. */
export function outsidePathArgs(cwd: string, args: string[]): string[] {
  return args.filter((arg) => {
    if (arg.startsWith("-") || /^[a-z][a-z0-9+.-]*:\/\//i.test(arg) || !PATH_LIKE.test(arg)) return false;
    const looksLikePath = arg.includes("/") || arg.includes("\\") || arg.startsWith(".") || isAbsolute(arg);
    if (!looksLikePath) return false;
    return !isInsideDir(cwd, resolve(cwd, arg));
  });
}

const GIT_READ_ONLY = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files", "blame", "branch"]);
const BUN_ALLOWED = new Set(["install", "i", "add", "remove", "rm", "pm", "--version", "-v"]);
const NPX_SCRIPT_RUNNERS = new Set(["tsx", "ts-node", "node", "bun", "esno", "vite-node"]);

/**
 * Checks one command against the ownership rules and returns the arguments
 * to actually run. `node` is locked to the agent's folder with Node's
 * permission mode: reads and writes elsewhere and child processes are
 * refused (ERR_ACCESS_DENIED) — checked on Node 22.17.1, Windows.
 */
export function guardCommand(cmd: string, args: string[], cwd: string, writableFile?: WritableFile, readOnlyDirs: string[] = []): { error?: string; args: string[] } {
  const readable = (arg: string) => readOnlyDirs.some((d) => isInsideDir(d, resolve(cwd, arg)));
  const outside = outsidePathArgs(cwd, args).filter((a) => !(READ_ONLY_COMMANDS.has(cmd) && readable(a)));
  if (outside.length > 0) {
    return { error: `${outside.join(", ")} is outside your folder. ${OUTSIDE_FOLDER_HINT}`, args };
  }
  // An agent limited to some files (the deploy agent) cannot use cp or mkdir
  // to reach the others.
  if (writableFile && (cmd === "cp" || cmd === "mkdir")) {
    const target = [...args].reverse().find((a) => !a.startsWith("-"));
    if (cmd === "mkdir" || !target || !writableFile(relativeInside(cwd, resolve(cwd, target)))) {
      return { error: `${cmd} ${target ?? ""} is not one of your files. ${NOT_YOUR_FILE_HINT}`, args };
    }
  }
  // 2026-10-04 (Ledgerly run 4): `git commit -am` from the backend swept the
  // frontend builder's work into a commit about a GSTIN fix. Builders may read
  // git; the system makes the checkpoints.
  if (cmd === "git" && !(args[0] && GIT_READ_ONLY.has(args[0]))) {
    return { error: `git ${args[0] ?? ""} is not allowed — the system makes the commits and checkpoints. You may use git status, diff, log and show to look.`, args };
  }
  if (cmd === "bun" && !(args[0] && BUN_ALLOWED.has(args[0]))) {
    return { error: "bun is only for installing packages here — run scripts with node.", args };
  }
  if (cmd === "npx" && args[0] && NPX_SCRIPT_RUNNERS.has(args[0])) {
    return { error: `npx ${args[0]} is not allowed — run scripts with node.`, args };
  }
  if (cmd === "node") {
    // Ledgerly run 4: an agent passed `--allow-fs-read=*`; Node adds repeated
    // allow flags together, so its own flag cancelled the folder lock. Only
    // the system sets permission flags.
    const permissionFlag = args.find((a) => /^--(allow-|permission|experimental-permission|experimental-policy|policy)/.test(a));
    if (permissionFlag) {
      return { error: `${permissionFlag} is not allowed — node's permissions are set by the system and keep scripts inside your folder.`, args };
    }
    const own = resolve(cwd);
    // a file-limited agent's scripts may read its folder but write nothing
    const write = writableFile ? [] : [`--allow-fs-write=${own}`];
    return { args: ["--permission", `--allow-fs-read=${own}`, ...write, "--allow-addons", ...args] };
  }
  return { args };
}

/** Build contexts and writable mounted host folders in a compose file that lie outside `cwd`. */
export function composePathsOutside(composeText: string, cwd: string): string[] {
  const found = new Set<string>();
  const check = (raw: string) => {
    const p = raw.trim().replace(/^["']|["']$/g, "");
    if (!p || !(p.startsWith(".") || isAbsolute(p))) return; // named volumes and images are not folders
    if (!isInsideDir(cwd, resolve(cwd, p))) found.add(p);
  };
  for (const line of composeText.split(/\r?\n/)) {
    const build = line.match(/^\s*(?:build|context)\s*:\s*(\S.*?)\s*$/);
    if (build) check(build[1]!);
    // A read-only mount only uses another agent's output (the backend
    // builder tests against ../db/migrations:...:ro) — it cannot change it.
    if (/^\s*-\s/.test(line) && /:ro["']?\s*$/.test(line)) continue;
    const volume = line.match(/^\s*-\s*["']?((?:\.{1,2}[\\/]|\.{1,2}$|[\\/]|[A-Za-z]:[\\/])[^:"']*)(?::|["']?\s*$)/);
    if (volume) check(volume[1]!);
    const source = line.match(/^\s*source\s*:\s*(\S.*?)\s*$/);
    if (source) check(source[1]!);
  }
  return [...found];
}

// 2026-10-08: deploy files belong to the deploy agent. In a fix round a builder may not change or delete them
// (Ledgerly 2: a frontend fix also deleted frontend/Dockerfile).
const DEPLOY_FILE = /(^|\/)(Dockerfile(\.[\w-]+)?|docker-compose[\w.-]*\.ya?ml|\.dockerignore|\.env(\.[\w-]+)?)$/;
export const isBuilderFixFile: WritableFile = (relPath) => !DEPLOY_FILE.test(relPath.replace(/\\/g, "/"));
