// The foundation of every generated app (2026-11-01, approved by Amit after proof run 3). Each build wrote login, roles, the
// answer format, secrets and the entry point from scratch, so the same kinds of bug could come back every time. These files
// are written once and proven once (backend.test.ts runs them on a real database), and every build starts from them; the
// builders write only what is specific to the app, and may not change them (the write guard refuses, and a finish check finds
// a change made any other way).
//
// The templates are plain source with no mark of how they were made: a customer reading the code sees an ordinary app.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

export interface FoundationFile {
  path: string;
  content: string;
}

interface Column {
  name: string;
  notNull?: boolean;
  default?: string;
  primaryKey?: boolean;
}

export interface FoundationPlan {
  auth: { signUp: string; signIn: string; hasRole: boolean; name: "none" | "optional" | "required" } | null;
  /** why the login files are the builder's in this app */
  authLeftToBuilder?: string;
}

const TEMPLATES = join(import.meta.dir, "..", "templates");
const SIGN_UP = /\/auth\/(sign-?up|register)$/i;
const SIGN_IN = /\/auth\/(sign-?in|log-?in)$/i;
const KNOWN_USER_COLUMNS = new Set(["id", "email", "password_hash", "role", "name", "created_at", "updated_at"]);

/** What the plan says the login must look like; null when it has no login, or a users table these files cannot fill. */
export function foundationPlan(plan: { apiContract?: { endpoints?: Array<{ method?: string; path?: string }> }; dbSchema?: { tables?: unknown[] } }): FoundationPlan {
  const posts = (plan.apiContract?.endpoints ?? []).filter((e) => String(e.method).toUpperCase() === "POST").map((e) => String(e.path ?? "").replace(/\/+$/, ""));
  const up = posts.find((p) => SIGN_UP.test(p))?.match(SIGN_UP)?.[1];
  const inn = posts.find((p) => SIGN_IN.test(p))?.match(SIGN_IN)?.[1];
  const users = (plan.dbSchema?.tables ?? []).find((t) => (t as { name?: string })?.name === "users") as { columns?: Column[] } | undefined;
  if (!up || !inn || !users) return { auth: null };
  const columns = users.columns ?? [];
  const has = (n: string) => columns.some((c) => c.name === n);
  if (!has("email") || !has("password_hash") || !has("id")) return { auth: null, authLeftToBuilder: "the users table has no email, password_hash or id column" };
  const unfillable = columns.filter((c) => !KNOWN_USER_COLUMNS.has(c.name) && c.notNull && c.default === undefined).map((c) => c.name);
  if (unfillable.length) return { auth: null, authLeftToBuilder: `the users table requires ${unfillable.join(", ")}` };
  const name = columns.find((c) => c.name === "name");
  return { auth: { signUp: up, signIn: inn, hasRole: has("role"), name: !name ? "none" : name.notNull && name.default === undefined ? "required" : "optional" } };
}

function listTemplates(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(relative(root, full).replace(/\\/g, "/"));
    }
  };
  walk(root);
  return out.sort();
}

const LOGIN_FILES = new Set(["src/controllers/auth.controller.ts", "src/routes/auth.routes.ts"]);

function renderLogin(path: string, content: string, auth: NonNullable<FoundationPlan["auth"]>): string {
  if (path === "src/routes/auth.routes.ts") return content.replace("__SIGN_UP__", auth.signUp).replace("__SIGN_IN__", auth.signIn);
  const named = auth.name !== "none";
  const field = auth.name === "required" ? 'name: z.string().trim().min(1, "Enter your name"),' : 'name: z.string().trim().min(1).optional(),';
  return content
    .replace("__USER_COLUMNS__", ["id", "email", ...(auth.hasRole ? ["role"] : []), ...(named ? ["name"] : [])].join(", "))
    .replace("/*__NAME_FIELD__*/", named ? field : "")
    .replace("/*__NAME_VAR__*/", named ? ", name" : "")
    .replace("__INSERT_COLUMNS__", `email, password_hash${named ? ", name" : ""}`)
    .replace("__INSERT_VALUES__", `$1, $2${named ? ", $3" : ""}`)
    .replace("__INSERT_PARAMS__", `email, passwordHash${named ? ", name ?? null" : ""}`)
    .replace(/^\s*\n(?=\}\);)/m, "");
}

export function backendFoundationFiles(plan: FoundationPlan): FoundationFile[] {
  const root = join(TEMPLATES, "backend");
  return listTemplates(root)
    .filter((p) => plan.auth || !LOGIN_FILES.has(p))
    .map((path) => {
      const content = readFileSync(join(root, path), "utf-8").replace(/\r\n/g, "\n");
      return { path, content: LOGIN_FILES.has(path) ? renderLogin(path, content, plan.auth!) : content };
    });
}

export function frontendFoundationFiles(): FoundationFile[] {
  const root = join(TEMPLATES, "frontend");
  return listTemplates(root).map((path) => ({ path, content: readFileSync(join(root, path), "utf-8").replace(/\r\n/g, "\n") }));
}

// Beside the builder's folder, not in it: nothing of the record is in what the customer gets.
const recordFile = (dir: string) => join(dirname(dir), ".nexsidi", `base-files-${basename(dir)}.json`);
const hash = (s: string) => createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex");

function readRecord(dir: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(recordFile(dir), "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function writeFoundation(dir: string, files: FoundationFile[]): void {
  const record: Record<string, string> = {};
  for (const f of files) {
    const abs = join(dir, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content, "utf-8");
    record[f.path] = hash(f.content);
  }
  mkdirSync(dirname(recordFile(dir)), { recursive: true });
  writeFileSync(recordFile(dir), JSON.stringify(record, null, 2));
}

const normal = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");

export function isFoundationFile(dir: string, path: string): boolean {
  return normal(path) in readRecord(dir);
}

/** Foundation files that are no longer as they were written. */
export function foundationChanges(dir: string): string[] {
  return Object.entries(readRecord(dir))
    .filter(([path, h]) => !existsSync(join(dir, path)) || hash(readFileSync(join(dir, path), "utf-8")) !== h)
    .map(([path]) => path);
}

/**
 * Writes changed or deleted foundation files back, only with the content recorded when the build started. The builders may
 * not write these files, so this cannot be left to them. Returns what was put back.
 */
export function putBackFoundation(dir: string, files: FoundationFile[]): string[] {
  const record = readRecord(dir);
  const put: string[] = [];
  for (const path of foundationChanges(dir)) {
    const file = files.find((f) => f.path === path);
    if (!file || hash(file.content) !== record[path]) continue;
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, "utf-8");
    put.push(path);
  }
  return put;
}

/** What a plan's tasks must no longer ask the backend builder for. */
export function backendHeldFiles(plan: FoundationPlan): string[] {
  const written = backendFoundationFiles(plan).map((f) => f.path);
  // Names a plan may give the same files.
  const sameJob = ["package.json", "tsconfig.json", "Dockerfile", "src/server.ts", "src/middleware/rateLimit.ts", "src/middleware/rate-limit.ts", "src/middleware/rate-limiter.ts", ...(plan.auth ? ["src/controllers/auth.ts", "src/routes/auth.ts"] : [])];
  return [...written, ...sameJob];
}

export function frontendHeldFiles(): string[] {
  return frontendFoundationFiles().map((f) => f.path);
}

/** The plan's tasks without the files the foundation already holds; a task left with nothing is dropped. */
export function withoutFoundationFiles<T extends { outputFiles: string[] }>(tasks: T[], foundation: string[]): T[] {
  const held = new Set(foundation.map(normal));
  return tasks
    .map((t) => ({ ...t, outputFiles: t.outputFiles.filter((f) => !held.has(normal(f))) }))
    .filter((t) => t.outputFiles.length > 0);
}
