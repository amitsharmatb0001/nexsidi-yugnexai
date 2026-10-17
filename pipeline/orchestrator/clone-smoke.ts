// A delivered app is only "done" once it has actually answered. Containers that are up and ports that are open say
// nothing about whether a page renders or the API responds, so this opens the app the way a visitor would.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PAGE_FILE = /^page\.(tsx|jsx|ts|js)$/;

/** URL paths of the pages reachable without a parameter: no dynamic segments, no API routes. Route groups "(x)" add no path. */
export function staticRoutes(frontendDir: string): string[] {
  const appDir = join(frontendDir, "app");
  if (!existsSync(appDir)) return [];
  const routes: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry.includes("[") || entry.startsWith("_") || entry.startsWith("@")) continue;
        if (segments.length === 0 && entry === "api") continue;
        walk(full, entry.startsWith("(") && entry.endsWith(")") ? segments : [...segments, entry]);
      } else if (PAGE_FILE.test(entry)) {
        routes.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(appDir, []);
  return [...new Set(routes)].sort();
}

export interface SmokeOptions {
  frontendUrl: string;
  backendUrl: string;
  routes: string[];
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  // The address a visitor's browser uses for the app (http://localhost:<port>), and the port of the app's own API.
  // When both are given, the check also reads what the built frontend calls and asks the API about that address.
  publicOrigin?: string;
  ownBackendPort?: number;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  delayMs?: number;
}

export interface SmokeResult {
  ok: boolean;
  failures: string[];
}

const MIN_HOME_BYTES = 200;

async function once(opts: SmokeOptions, get: (url: string, init?: RequestInit) => Promise<Response>): Promise<string[]> {
  const failures: string[] = [];
  for (const route of opts.routes) {
    try {
      const r = await get(`${opts.frontendUrl}${route}`);
      if (r.status >= 500) failures.push(`${route} answered ${r.status}`);
      else if (route === "/" && r.status === 200 && (await r.text()).length < MIN_HOME_BYTES) failures.push("/ rendered an empty page");
      else if (route === "/" && r.status >= 400) failures.push(`/ answered ${r.status}`);
    } catch (err) {
      failures.push(`${route} could not be reached (${String(err).slice(0, 80)})`);
    }
  }
  try {
    const r = await get(opts.backendUrl);
    // Any answer, even "not found", shows the API process is serving; only a server error or silence is a failure.
    if (r.status >= 500) failures.push(`API answered ${r.status}`);
  } catch (err) {
    failures.push(`API could not be reached (${String(err).slice(0, 80)})`);
  }
  if (opts.publicOrigin && opts.ownBackendPort !== undefined && failures.length === 0) {
    failures.push(...(await wiringFailures(opts, get)));
  }
  return failures;
}

/** Opens the app's home page and public pages and the API, retrying while it warms up. */
export async function smokeCheck(opts: SmokeOptions): Promise<SmokeResult> {
  const get = opts.fetchFn ?? ((url: string) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000) }));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = opts.attempts ?? 6;
  let failures: string[] = [];
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(opts.delayMs ?? 5000);
    failures = await once(opts, get);
    if (failures.length === 0) return { ok: true, failures: [] };
  }
  return { ok: false, failures };
}

const CHUNK_LIMIT = 80;
// Ports where the frontends (3200-3299) and backends (3300-3399) of this system's apps live. A browser never calls a
// database port, so those are not looked at.
const APP_PORT_RANGES: [number, number][] = [[3200, 3399]];

/** Does the built frontend call its own API, and does that API accept the app's own address? */
async function wiringFailures(opts: SmokeOptions, get: (url: string, init?: RequestInit) => Promise<Response>): Promise<string[]> {
  const failures: string[] = [];
  const ownFrontend = Number(new URL(opts.publicOrigin!).port);
  const own = new Set<number>([ownFrontend, opts.ownBackendPort!]);
  try {
    // The API address is often only in the script of the page that uses it (sign-up), so every page is read.
    const scripts = new Set<string>();
    for (const route of opts.routes) {
      const html = await (await get(`${opts.frontendUrl}${route}`)).text();
      for (const m of html.matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)) scripts.add(m[1]!);
    }
    const foreign = new Set<number>();
    for (const src of [...scripts].slice(0, CHUNK_LIMIT)) {
      const text = await (await get(new URL(src, `${opts.frontendUrl}/`).toString())).text();
      for (const m of text.matchAll(/(?:localhost|127\.0\.0\.1):(\d{4,5})(?!\d)/g)) {
        const port = Number(m[1]);
        if (!own.has(port) && APP_PORT_RANGES.some(([lo, hi]) => port >= lo && port <= hi)) foreign.add(port);
      }
    }
    for (const port of foreign) {
      failures.push(`the frontend calls http://localhost:${port}, but this app's API is on port ${opts.ownBackendPort}`);
    }
  } catch (err) {
    failures.push(`could not read the frontend's scripts (${String(err).slice(0, 80)})`);
  }
  try {
    const r = await get(opts.backendUrl, { method: "OPTIONS", headers: { origin: opts.publicOrigin!, "access-control-request-method": "POST" } });
    const allowed = r.headers.get("access-control-allow-origin");
    if (allowed !== opts.publicOrigin && allowed !== "*") {
      failures.push(`the API does not allow the app's own address ${opts.publicOrigin} (it allows ${allowed ?? "nothing"})`);
    }
  } catch (err) {
    failures.push(`the API's cross-origin check could not run (${String(err).slice(0, 80)})`);
  }
  return failures;
}
