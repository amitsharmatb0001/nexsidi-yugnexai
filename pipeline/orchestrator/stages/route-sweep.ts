// Route sweep — opens EVERY page of the deployed app in a real browser, signed out and signed in, and
// reports what it saw (2026-10-05, Ledgerly run 4).
//
// Why: the live review's agents visit only the pages they choose to click through. A wrong route, a dead
// link, a failing request or a console error on a page nobody opened was invisible to every real-browser
// step; only the code reviewers could have caught it, by reading. This step needs no model: the route list
// comes from the app's own page files, the verdicts from what the browser reports (HTTP status, console
// errors, uncaught errors, failed requests, the page text). Anything it cannot open is listed as "not
// checked" with the reason — never guessed (a dynamic route has no id to open without real data).
import { join } from "node:path";
import { contractAuthPaths } from "./auth-smoke.ts";

export interface BrowserLike {
  send(action: string, args?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface PageRoute {
  route: string;
  file: string;
}

export interface Visit {
  route: string;
  auth: "signed-out" | "signed-in";
  status: number | null;
  finalPath: string;
  bodyText: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: Array<{ method: string; url: string; status: number; failure?: string }>;
  loadError: string | null;
  /** Desktop (1280x800) unless set. */
  viewport?: "desktop" | "phone";
  /** How many pixels the page is wider than the screen (document scroll width minus window width). */
  overflowPx?: number;
  /** Header / nav links and buttons that sit partly or fully off-screen. */
  clippedNav?: string[];
  /** Height of the page header (the first <header>, else the first <nav>) in pixels. */
  headerHeightPx?: number;
}

/** Above this a phone header has wrapped into rows instead of folding into a menu button (folded headers are ~56-72px). */
export const PHONE_HEADER_MAX_PX = 120;

export const PHONE_VIEWPORT = { width: 375, height: 812 };
export const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

const PAGE_FILE = /^app\/(?:.*\/)?page\.(?:tsx|jsx|ts|js)$/;
const HANDLER_FILE = /^app\/(?:.*\/)?route\.(?:ts|js)$/;

/** Turns the file list under app/ into page routes and route-handler paths (route groups and parallel slots dropped). */
export function discoverRoutes(files: string[]): { pages: PageRoute[]; handlers: string[] } {
  const toRoute = (file: string, leaf: RegExp): string | null => {
    const dir = file.replace(leaf, "").replace(/^app\/?/, "");
    const segs = dir.split("/").filter(Boolean);
    if (segs.some((s) => s.startsWith("@"))) return null;
    const kept = segs.filter((s) => !/^\(.*\)$/.test(s));
    return "/" + kept.join("/");
  };
  const pages: PageRoute[] = [];
  const handlers: string[] = [];
  for (const file of files.map((f) => f.replace(/\\/g, "/"))) {
    if (PAGE_FILE.test(file)) {
      const route = toRoute(file, /\/?page\.(?:tsx|jsx|ts|js)$/);
      if (route !== null) pages.push({ route, file });
    } else if (HANDLER_FILE.test(file)) {
      const route = toRoute(file, /\/?route\.(?:ts|js)$/);
      if (route !== null) handlers.push(route);
    }
  }
  return { pages, handlers };
}

const isDynamic = (route: string) => /\[/.test(route);

export function routeMatches(pattern: string, path: string): boolean {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (/^\[\.\.\..+\]$/.test(seg) || /^\[\[\.\.\..+\]\]$/.test(seg)) return s.length > i || /^\[\[/.test(seg);
    if (s[i] === undefined) return false;
    if (/^\[.+\]$/.test(seg)) continue;
    if (seg !== s[i]) return false;
  }
  return p.length === s.length;
}

/** Internal links that match no page and no route handler. Anchors, mailto, external, /api, /_next and file links are ignored. */
export function linkTargetsMissing(
  links: Array<{ href: string; from: string }>,
  routes: string[],
  handlers: string[],
): Array<{ href: string; from: string[] }> {
  const missing = new Map<string, Set<string>>();
  for (const { href, from } of links) {
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const path = href.split(/[?#]/)[0]!.replace(/(.)\/+$/, "$1");
    if (path.startsWith("/api/") || path === "/api" || path.startsWith("/_next")) continue;
    if (/\.[a-z0-9]{2,5}$/i.test(path)) continue;
    if (routes.some((r) => routeMatches(r, path)) || handlers.some((h) => routeMatches(h, path))) continue;
    if (!missing.has(path)) missing.set(path, new Set());
    missing.get(path)!.add(from);
  }
  return [...missing.entries()].map(([href, from]) => ({ href, from: [...from] }));
}

const NOT_FOUND_TEXT = /\b404\b|page could not be found|page not found|not found/i;

/** What a visit shows that is wrong, as plain sentences with the evidence. Empty = healthy. */
export function judgeVisit(v: Visit): string[] {
  const where = `${v.route} (${v.auth}${v.viewport === "phone" ? ", on a phone" : ""})`;
  if (v.loadError) return [`${where} did not load: ${v.loadError}`];
  const out: string[] = [];
  // 2026-10-08: on a phone only the layout is judged (the errors and requests were already judged on the desktop visit).
  const problems: string[] = [];
  if ((v.overflowPx ?? 0) > 8) problems.push(`is ${v.overflowPx}px wider than the phone screen, so the page scrolls sideways`);
  if ((v.clippedNav?.length ?? 0) > 0) problems.push(`has header items that do not fit on the screen: ${v.clippedNav!.join(", ")}`);
  // 2026-10-22 (Trailhead): a header wrapped into three rows took ~130px of every phone screen; nothing overflowed.
  if (v.viewport === "phone" && (v.headerHeightPx ?? 0) > PHONE_HEADER_MAX_PX) {
    problems.push(`has a header ${v.headerHeightPx}px tall, so its links wrapped into rows; fold them into a menu button on a phone`);
  }
  const layout = problems.length > 0 ? [`${where} ${problems.join(" and ")}`] : [];
  if (v.viewport === "phone") return layout;
  if (v.status !== null && v.status >= 400) out.push(`${where} answered HTTP ${v.status}`);
  const text = v.bodyText.trim();
  if (text.length < 20) out.push(`${where} is blank — the page rendered no visible text`);
  else if (text.length < 300 && NOT_FOUND_TEXT.test(text.slice(0, 200))) out.push(`${where} shows a "not found" page: "${text.slice(0, 80).replace(/\s+/g, " ")}"`);
  for (const e of v.pageErrors) out.push(`${where} threw an uncaught error: ${e.slice(0, 220)}`);
  for (const e of v.consoleErrors) {
    if (/^Failed to load resource/i.test(e)) continue; // the failed request itself is reported below
    out.push(`${where} logged a console error: ${e.slice(0, 220)}`);
  }
  for (const r of v.failedRequests) {
    if (/\/favicon\.ico(\?|$)/.test(r.url)) continue;
    if (r.status === 0 && /ERR_ABORTED/.test(r.failure ?? "")) continue;
    if (v.auth === "signed-out" && (r.status === 401 || r.status === 403)) continue;
    out.push(`${where} made a request that failed: ${r.method} ${r.url} -> ${r.status || r.failure || "no response"}`);
  }
  return [...out, ...layout];
}

/**
 * The same header or width problem shows on every page at phone width. One finding per distinct problem, naming every
 * page it was seen on and pointing at the shared header, is what a builder can act on (eight copies would be noise).
 */
export function mergePhoneFindings(findings: Array<{ file: string; issue: string }>): Array<{ file: string; issue: string }> {
  const groups = new Map<string, { file: string; routes: string[]; detail: string }>();
  const rest: Array<{ file: string; issue: string }> = [];
  for (const f of findings) {
    const m = f.issue.match(/^\[route-sweep\] (\S+) \((?:signed-in|signed-out), on a phone\) (.*)$/);
    if (!m) { rest.push(f); continue; }
    const detail = m[2]!;
    const g = groups.get(detail) ?? { file: f.file, routes: [], detail };
    g.routes.push(m[1]!);
    groups.set(detail, g);
  }
  const merged = [...groups.values()].map((g) => ({
    file: g.file,
    issue: `[route-sweep] on a phone (375px wide), ${g.routes.length} page(s) (${g.routes.join(", ")}): the page ${g.detail}. The header is shared by these pages, so fix it once in the shared header or layout component (on a phone, fold the links into a menu button that opens them; do not let them wrap into rows), and wrap any wide table in a container that scrolls sideways inside itself.`,
  }));
  return [...rest, ...merged];
}

export interface RouteSweepOptions {
  appUrl: string;
  backendUrl: string;
  endpoints: Array<{ method: string; path: string }>;
  /** Files under the frontend folder, relative to it (only app/** is used). */
  routeFiles: string[];
  browser: BrowserLike;
  fetchFn?: typeof fetch;
  /** Where to save one screenshot per visit; null = none. */
  screenshotDir: string | null;
  /** Creates sample data as the signed-in test account; the ids it returns open the detail pages. */
  seed?: (token: string) => Promise<{ created: Record<string, string[]>; notSeeded: string[] }>;
  /** An account the caller already created (the review agents use the same one); otherwise the sweep makes its own. */
  session?: { token: string };
}

export interface RouteSweepResult {
  ran: boolean;
  pass: boolean;
  findings: Array<{ file: string; issue: string }>;
  notChecked: string[];
  visited: number;
  /** Sample records created for the test (resource -> ids). */
  seeded: Record<string, string[]>;
}

const PAGE_INFO_EXPRESSION =
  "/*page*/ ({ text: (document.body ? document.body.innerText : '').slice(0, 2000), links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || ''), " +
  "overflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), " +
  "clippedNav: [...document.querySelectorAll('header a, header button, nav a, nav button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1); }).map((e) => (e.textContent || '').trim()).filter(Boolean), " +
  "headerHeightPx: Math.round((document.querySelector('header') || document.querySelector('nav'))?.getBoundingClientRect().height || 0) })";

const pageFileFor = (file: string) => `frontend/${file}`;
const slug = (route: string) => (route === "/" ? "home" : route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""));

/** A test account on the reserved test domain (removed with everything under it when the live review ends). */
export async function createReviewAccount(
  opts: {
    backendUrl: string;
    endpoints: Array<{ method: string; path: string }>;
    fetchFn?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    /** Runs after sign-up and before sign-in, e.g. to give the account a role so the sign-in token carries it. */
    beforeLogin?: (email: string) => Promise<void> | void;
    /** Part of the address, so accounts made in the same millisecond differ (e.g. the role name). */
    label?: string;
  },
): Promise<{ email: string; password: string; token: string } | { reason: string }> {
  const auth = contractAuthPaths(opts.endpoints);
  if (!auth) return { reason: "the API contract has no register and login endpoints" };
  const fetchFn = opts.fetchFn ?? fetch;
  const stamp = Date.now();
  // example.com is the reserved test domain; every account on it is removed when the live review ends.
  const email = `verify+${opts.label ?? "review"}${stamp}@example.com`;
  const password = `Review!${stamp}aA1x`;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // A 429 with Retry-After is the app's own sign-in limiter (the deploy checks just used the minute's attempts):
  // wait out the window and try again, up to 3 times.
  const post = async (path: string, body: object) => {
    for (let attempt = 1; ; attempt++) {
      const res = await fetchFn(opts.backendUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 429 && attempt < 3) {
        const seconds = Number(res.headers.get("retry-after"));
        await sleep((Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000 + 1000);
        continue;
      }
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { ok: res.ok, status: res.status, json, text };
    }
  };
  const reg = await post(auth.registerPath, { email, password, name: "Review Account" });
  if (!reg.ok) return { reason: `could not create a test account (register answered ${reg.status}: ${(reg.json?.error ?? reg.text).toString().slice(0, 160)})` };
  if (opts.beforeLogin) await opts.beforeLogin(email);
  const login = await post(auth.loginPath, { email, password });
  const token = login.json?.data?.token ?? login.json?.token ?? reg.json?.data?.token ?? reg.json?.token;
  if (!login.ok || typeof token !== "string") return { reason: `could not sign the test account in (login answered ${login.status})` };
  return { email, password, token };
}

async function visitPage(browser: BrowserLike, opts: RouteSweepOptions, route: string, auth: Visit["auth"], file: string | null, links: Array<{ href: string; from: string }>, viewport: "desktop" | "phone" = "desktop"): Promise<Visit> {
  const before = {
    console: (((await browser.send("consoleErrors")) as any)?.consoleErrors ?? []).length as number,
    page: (((await browser.send("consoleErrors")) as any)?.pageErrors ?? []).length as number,
    failed: (((await browser.send("failedRequests")) as any)?.failed ?? []).length as number,
  };
  const v: Visit = { route, auth, status: null, finalPath: route, bodyText: "", consoleErrors: [], pageErrors: [], failedRequests: [], loadError: null, viewport };
  try {
    const nav = (await browser.send("navigate", { url: opts.appUrl.replace(/\/$/, "") + route })) as { status: number | null; finalUrl?: string; url?: string };
    v.status = nav?.status ?? null;
    try { v.finalPath = new URL(nav?.finalUrl ?? nav?.url ?? "", "http://x").pathname; } catch { /* keep route */ }
    const info = ((await browser.send("evaluate", { expression: PAGE_INFO_EXPRESSION })) as any)?.value as { text?: string; links?: string[]; overflowPx?: number; clippedNav?: string[]; headerHeightPx?: number } | null;
    v.bodyText = info?.text ?? "";
    v.overflowPx = info?.overflowPx ?? 0;
    v.clippedNav = info?.clippedNav ?? [];
    v.headerHeightPx = info?.headerHeightPx ?? 0;
    if (viewport === "desktop") for (const href of info?.links ?? []) links.push({ href, from: route });
    if (opts.screenshotDir) {
      await browser.send("screenshot", { path: join(opts.screenshotDir, `${viewport === "phone" ? "phone-" : ""}${auth}-${slug(route)}.png`), fullPage: true }).catch(() => {});
    }
  } catch (err) {
    v.loadError = String(err instanceof Error ? err.message : err).slice(0, 200);
  }
  const after = (await browser.send("consoleErrors")) as any;
  v.consoleErrors = (after?.consoleErrors ?? []).slice(before.console);
  v.pageErrors = (after?.pageErrors ?? []).slice(before.page);
  v.failedRequests = (((await browser.send("failedRequests")) as any)?.failed ?? []).slice(before.failed);
  void file;
  return v;
}

export async function runRouteSweep(opts: RouteSweepOptions): Promise<RouteSweepResult> {
  const { browser } = opts;
  const { pages, handlers } = discoverRoutes(opts.routeFiles);
  const findings: Array<{ file: string; issue: string }> = [];
  const notChecked: string[] = [];
  const links: Array<{ href: string; from: string }> = [];
  let visited = 0;
  let seeded: Record<string, string[]> = {};
  if (pages.length === 0) return { ran: false, pass: true, findings, notChecked: ["route sweep: the app has no page files under app/"], visited, seeded };

  const fileOf = new Map(pages.map((p) => [p.route, p.file]));
  const staticRoutes = pages.filter((p) => !isDynamic(p.route));
  const dynamicRoutes = pages.filter((p) => isDynamic(p.route));

  const pass = async (auth: Visit["auth"], extra: string[], viewport: "desktop" | "phone" = "desktop") => {
    const targets = [...staticRoutes.map((p) => p.route), ...extra];
    const results: Visit[] = [];
    if (viewport === "phone") await browser.send("setViewport", PHONE_VIEWPORT);
    try {
      for (const route of targets) {
        const v = await visitPage(browser, opts, route, auth, fileOf.get(route) ?? null, links, viewport);
        visited++;
        results.push(v);
      }
    } finally {
      if (viewport === "phone") await browser.send("setViewport", DESKTOP_VIEWPORT);
    }
    return results;
  };

  const report = (results: Visit[]) => {
    for (const v of results) {
      const file = pageFileFor(fileOf.get(v.route) ?? [...fileOf.entries()].find(([pat]) => routeMatches(pat, v.route))?.[1] ?? "app/page.tsx");
      for (const issue of judgeVisit(v)) findings.push({ file, issue: `[route-sweep] ${issue}` });
    }
  };

  // Signed out.
  await browser.send("newSession");
  const out = await pass("signed-out", []);
  report(out);
  // The same pages at phone width (a phone is the first screen many users have).
  report(await pass("signed-out", [], "phone"));

  // Signed in: a test account, then the session cookie the generated apps use.
  const session = opts.session ?? (await createReviewAccount(opts));
  let signedIn: Visit[] = [];
  if ("reason" in session) {
    notChecked.push(`route sweep, signed-in pages: ${session.reason}`);
  } else {
    await browser.send("newSession");
    await browser.send("navigate", { url: opts.appUrl });
    await browser.send("evaluate", { expression: `document.cookie = "token=${session.token}; path=/; SameSite=Strict"` });
    // Sample data first (when asked for), so the pages have something to show and detail pages have a real id.
    if (opts.seed) {
      try {
        const made = await opts.seed(session.token);
        seeded = made.created;
        notChecked.push(...made.notSeeded);
      } catch (err) {
        notChecked.push(`sample data could not be created: ${String(err).slice(0, 200)}`);
      }
    }
    // Dynamic routes are opened with the id of a sample record of the same resource, or through a real link the
    // pages showed — an id is never guessed.
    const samples = new Set<string>();
    for (const d of dynamicRoutes) {
      const resource = d.route.split("/").filter(Boolean)[0] ?? "";
      const sampleId = seeded[resource]?.[0];
      if (sampleId) {
        samples.add(d.route.replace(/\[[^\]]+\]/g, sampleId));
        continue;
      }
      const link = links.map((l) => l.href.split(/[?#]/)[0]!).find((h) => routeMatches(d.route, h) && !staticRoutes.some((p) => routeMatches(p.route, h)));
      if (link) samples.add(link);
    }
    signedIn = await pass("signed-in", [...samples]);
    // A session the app did not accept shows as every protected page landing on a sign-in page.
    const bounced = signedIn.filter((v) => /sign-?in|log-?in/.test(v.finalPath) && !/sign-?in|log-?in/.test(v.route));
    if (bounced.length > 0 && bounced.length >= signedIn.filter((v) => !/sign-?in|log-?in|sign-?up|register/.test(v.route) && v.route !== "/").length) {
      notChecked.push(`route sweep, signed-in pages: the app did not accept the test session cookie (${bounced.map((b) => b.route).join(", ")} ended on a sign-in page)`);
      signedIn = signedIn.filter((v) => !bounced.includes(v));
    }
    report(signedIn);
    report(await pass("signed-in", [...samples], "phone"));
  }

  for (const d of dynamicRoutes) {
    const opened = signedIn.some((v) => routeMatches(d.route, v.route) && !staticRoutes.some((p) => routeMatches(p.route, v.route)));
    if (!opened) notChecked.push(`route sweep: ${d.route} was not opened — no link to a real example was found on any page (the test account has no data), so no id was guessed`);
  }

  // Links on the pages that lead nowhere.
  for (const m of linkTargetsMissing(links, pages.map((p) => p.route), handlers)) {
    const fromRoute = m.from[0]!;
    const file = pageFileFor(fileOf.get(fromRoute) ?? "app/page.tsx");
    findings.push({ file, issue: `[route-sweep] a link to ${m.href} (on ${m.from.join(", ")}) matches no page or route of the app` });
  }

  const merged = mergePhoneFindings(findings);
  return { ran: true, pass: merged.length === 0, findings: merged, notChecked, visited, seeded };
}

/** The real run: the app's own page files, a real browser, screenshots kept in the hidden evidence folder. */
export async function runRouteSweepReal(
  frontendOutputDir: string,
  appUrl: string,
  backendUrl: string,
  endpoints: Array<{ method: string; path: string }>,
  seed?: RouteSweepOptions["seed"],
  session?: RouteSweepOptions["session"],
): Promise<RouteSweepResult> {
  const { readdirSync, mkdirSync } = await import("node:fs");
  const { BrowserSession } = await import("../../../packages/agent-runtime/src/browser/client.ts");
  const walk = (rel: string): string[] => {
    try {
      return readdirSync(join(frontendOutputDir, rel), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(`${rel}/${e.name}`)) : [`${rel}/${e.name}`],
      );
    } catch {
      return [];
    }
  };
  const screenshotDir = join(frontendOutputDir, ".nexsidi-evidence", "route-sweep");
  mkdirSync(screenshotDir, { recursive: true });
  const browser = new BrowserSession();
  try {
    return await runRouteSweep({ appUrl, backendUrl, endpoints, routeFiles: walk("app"), browser, screenshotDir, seed, session });
  } finally {
    await browser.close().catch(() => {});
  }
}
