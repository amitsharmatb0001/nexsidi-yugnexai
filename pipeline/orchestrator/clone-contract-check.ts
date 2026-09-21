// Cross-layer contract check for the clone flow (2026-09-02, real user
// request, after a live test proved the gap): a backend pass and a frontend
// pass each independently pass their OWN build/typecheck, but neither can
// see the other's real code — nothing stops them from disagreeing about the
// actual HTTP contract between them. Confirmed live: a real run built a
// backend route POST /wishlist/:dropId (id in the URL) and a frontend call
// POST /api/v1/wishlist with the id in the JSON body instead — both sides
// compiled clean, and the feature would 404 at runtime.
//
// This is deterministic, zero-LLM-cost source inspection — no live server,
// no browser, no docker. It extracts the REAL routes Express actually
// registers (by reading app.ts's mount prefix, index.ts's per-resource
// mount prefixes, and each route file's own internal paths — resolved
// together, since this codebase's generators mix both conventions: some
// resource files write paths relative to their own mount prefix, others
// write self-contained paths and are mounted at "/") and the REAL calls the
// new frontend code makes via the shared apiFetch() client, then compares
// them structurally (Express :param and a frontend ${} interpolation are
// the same wildcard).
//
// Deliberately heuristic (regex-based source scanning, not a real Express
// route table or a full TS parse) and scoped to ONLY the frontend files
// this clone's edit pass just wrote — pre-existing calls elsewhere in the
// app already work in production and aren't what changed. A mismatch here
// is a strong signal precisely because of that narrow scope; "nothing to
// compare" is reported as inconclusive, never coerced into a false pass.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface ApiCall {
  method: string;
  path: string;
}

export function normalizePath(path: string): string {
  const withWildcards = path
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, "*")
    .replace(/\$\{[^}]*\}/g, "*");
  const trimmed = withWildcards.replace(/\/+$/, "");
  return trimmed || "/";
}

function joinPath(a: string, b: string): string {
  const left = a.replace(/\/+$/, "");
  const right = b === "/" || b === "" ? "" : b.startsWith("/") ? b : `/${b}`;
  return `${left}${right}` || "/";
}

// The one fixed constant this codebase's real generated backends use
// (confirmed live: `app.use("/api/v1", routes)` in app.ts) — read from the
// real file when available, falling back to that same established
// convention rather than guessing something else.
export function extractApiBasePrefix(appTsContent: string | null): string {
  if (!appTsContent) return "/api/v1";
  const match = appTsContent.match(/app\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*routes\s*\)/);
  return match?.[1] ?? "/api/v1";
}

// Maps a route file's own basename (e.g. "auth.routes") to the mount prefix
// index.ts actually gives it. Real, observed shapes both handled: auth.routes
// writes paths relative to its own "/auth" mount; wishlist.routes writes
// self-contained paths and is mounted at "/" — this resolves either
// correctly since it reads the REAL router.use() call, not an assumption.
export function extractRouteMounts(indexTsContent: string): Record<string, string> {
  const importRe = /import\s+(\w+)\s+from\s+["'`]\.\/([\w.-]+)["'`]/g;
  const identToFile: Record<string, string> = {};
  for (const m of indexTsContent.matchAll(importRe)) {
    identToFile[m[1]!] = m[2]!;
  }
  const useRe = /router\.use\(\s*["'`]([^"'`]*)["'`]\s*,\s*(\w+)\s*\)/g;
  const fileToMount: Record<string, string> = {};
  for (const m of indexTsContent.matchAll(useRe)) {
    const file = identToFile[m[2]!];
    if (file) fileToMount[file] = m[1]!;
  }
  return fileToMount;
}

const EXPRESS_ROUTE_RE = /router\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/g;

export function extractBackendRoutes(
  routeFiles: Record<string, string>, // filename (e.g. "wishlist.routes.ts") -> content
  routeMounts: Record<string, string>, // basename (e.g. "wishlist.routes") -> mount prefix from index.ts
  basePrefix: string,
): ApiCall[] {
  const routes: ApiCall[] = [];
  for (const [filename, content] of Object.entries(routeFiles)) {
    const base = filename.replace(/\.ts$/, "");
    const mountPrefix = routeMounts[base] ?? "/";
    for (const match of content.matchAll(EXPRESS_ROUTE_RE)) {
      const fullPath = joinPath(joinPath(basePrefix, mountPrefix), match[2]!);
      routes.push({ method: match[1]!.toUpperCase(), path: normalizePath(fullPath) });
    }
  }
  return routes;
}

// Matches this codebase's established shared HTTP client convention
// (lib/api.ts's apiFetch, used consistently instead of raw fetch — confirmed
// across every generated project read this session) — a call with no
// explicit `method:` defaults to GET, the same default a typical fetch
// client uses.
const API_FETCH_RE = /apiFetch\(\s*(`[^`]*`|'[^']*'|"[^"]*")\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g;

export function extractFrontendApiCalls(fileContents: string[]): ApiCall[] {
  const calls: ApiCall[] = [];
  for (const content of fileContents) {
    for (const match of content.matchAll(API_FETCH_RE)) {
      const rawUrl = match[1]!.slice(1, -1);
      const methodMatch = (match[2] ?? "").match(/method:\s*["'](\w+)["']/);
      calls.push({ method: (methodMatch?.[1] ?? "GET").toUpperCase(), path: normalizePath(rawUrl) });
    }
  }
  return calls;
}

export interface ContractMismatch {
  frontendCall: ApiCall;
}

export function findContractMismatches(frontendCalls: ApiCall[], backendRoutes: ApiCall[]): ContractMismatch[] {
  const backendSet = new Set(backendRoutes.map((r) => `${r.method} ${r.path}`));
  return frontendCalls
    .filter((call) => !backendSet.has(`${call.method} ${call.path}`))
    .map((call) => ({ frontendCall: call }));
}

export interface CheckCrossLayerContractOptions {
  buildDir: string;
  frontendFilesWritten: string[]; // relative to frontend/ — the clone-changes pass's own filesWritten
}

export interface CheckCrossLayerContractResult {
  // false = nothing could be compared (no route files, no api calls found in
  // the new frontend files) — inconclusive, never a false pass or false fail.
  checked: boolean;
  mismatches: ContractMismatch[];
}

export interface CheckCrossLayerContractDeps {
  readFn?: (path: string) => string;
  existsFn?: (path: string) => boolean;
  readdirFn?: (dir: string) => string[];
}

export function checkCrossLayerContract(
  opts: CheckCrossLayerContractOptions,
  deps: CheckCrossLayerContractDeps = {},
): CheckCrossLayerContractResult {
  const readFn = deps.readFn ?? ((p: string) => readFileSync(p, "utf-8"));
  const existsFn = deps.existsFn ?? existsSync;
  const readdirFn = deps.readdirFn ?? ((d: string) => readdirSync(d));

  const routesDir = join(opts.buildDir, "backend", "src", "routes");
  if (!existsFn(routesDir)) return { checked: false, mismatches: [] };

  const routeFiles: Record<string, string> = {};
  for (const entry of readdirFn(routesDir)) {
    if (entry.endsWith(".routes.ts")) routeFiles[entry] = readFn(join(routesDir, entry));
  }
  if (Object.keys(routeFiles).length === 0) return { checked: false, mismatches: [] };

  const appTsPath = join(opts.buildDir, "backend", "src", "app.ts");
  const appTsContent = existsFn(appTsPath) ? readFn(appTsPath) : null;
  const basePrefix = extractApiBasePrefix(appTsContent);

  const indexTsPath = join(routesDir, "index.ts");
  const routeMounts = existsFn(indexTsPath) ? extractRouteMounts(readFn(indexTsPath)) : {};

  const backendRoutes = extractBackendRoutes(routeFiles, routeMounts, basePrefix);

  const frontendContents = opts.frontendFilesWritten
    .map((rel) => join(opts.buildDir, "frontend", rel))
    .filter((p) => existsFn(p) && (p.endsWith(".ts") || p.endsWith(".tsx")))
    .map((p) => readFn(p));
  const frontendCalls = extractFrontendApiCalls(frontendContents);

  if (frontendCalls.length === 0) return { checked: false, mismatches: [] };

  return { checked: true, mismatches: findContractMismatches(frontendCalls, backendRoutes) };
}
