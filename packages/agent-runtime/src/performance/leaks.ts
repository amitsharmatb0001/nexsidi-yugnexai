// Memory-leak detection (patent claim 9), two ways.
//
// 1. Reading the code (findLeakPatterns): the ways server code usually leaks.
//    - a list, map or set at the top of the file that a function keeps adding to and nothing ever removes from or limits;
//    - a listener added to a long-lived object (an event bus, the process) on every request, with no matching removal;
//    - a timer started on every call with no way to stop it;
//    - a new connection pool or client created inside a request handler;
//    - a connection taken from a pool (`pool.connect()`) and never released.
// 2. Measuring a running app (runLeakProbe + detectGrowth): the same GET routes are called again and again, memory is read
//    after each round, and a straight line fitted through the readings says whether memory climbs with the number of
//    requests. The first quarter of the readings is warm-up and is ignored. A rise that is collected again (a sawtooth) or
//    a flat line with noise is not reported. The probe only ever sends GET requests, and the memory reading is supplied by the
//    caller (a container's memory, or a number the app reports), so it works against any running app.
import ts from "typescript";

export interface LeakPattern {
  kind: "unbounded-collection" | "listener-per-request" | "timer-per-call" | "connection-per-request" | "connection-not-released";
  file: string;
  line: number;
  message: string;
}

const unwrap = (n: ts.Node): ts.Node => {
  let cur = n;
  while (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur) || ts.isAwaitExpression(cur)) cur = cur.expression;
  return cur;
};
const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
const GROW = new Set(["push", "unshift", "set", "add"]);
const SHRINK = new Set(["delete", "clear", "shift", "pop", "splice"]);
const REQUEST_LOCAL = new Set(["req", "res", "request", "response", "socket", "stream", "body"]);

export function findLeakPatterns(file: string, source: string): LeakPattern[] {
  const path = file.split("\\").join("/");
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path) || /\.(?:test|spec)\.[a-z]+$|(^|\/)node_modules\//.test(path)) return [];
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  } catch {
    return [];
  }
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out: LeakPattern[] = [];
  const text = source;

  // top-of-file collections
  const collections = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const init = unwrap(d.initializer);
      if (ts.isArrayLiteralExpression(init) && init.elements.length === 0) collections.set(d.name.text, "list");
      else if (ts.isObjectLiteralExpression(init) && init.properties.length === 0) collections.set(d.name.text, "object");
      else if (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && ["Map", "Set", "Array"].includes(init.expression.text) && (init.arguments?.length ?? 0) === 0) collections.set(d.name.text, init.expression.text.toLowerCase());
    }
  }
  const growth = new Map<string, number>();
  const bounded = new Set<string>();
  const clearIntervalPresent = /\bclearInterval\s*\(/.test(text);
  const walk = (n: ts.Node, fnDepth: number, handler: boolean, fnNode: ts.FunctionLikeDeclaration | null) => {
    let nextDepth = fnDepth;
    let nextHandler = handler;
    let nextFn = fnNode;
    if (isFn(n)) {
      nextDepth = fnDepth + 1;
      nextFn = n;
      nextHandler = n.parameters.some((p) => ts.isIdentifier(p.name) && (p.name.text === "req" || p.name.text === "request")) || handler;
    }
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const recvNode = unwrap(callee.expression);
        const recv = ts.isIdentifier(recvNode) ? recvNode.text : "";
        if (recv && collections.has(recv)) {
          if (GROW.has(method) && nextDepth >= 1 && !growth.has(recv)) growth.set(recv, lineOf(n));
          if (SHRINK.has(method)) bounded.add(recv);
        }
        if ((method === "on" || method === "addListener" || method === "addEventListener") && nextHandler && nextDepth >= 1 && recv && !REQUEST_LOCAL.has(recv)) {
          const removed = new RegExp(`\\b${recv}\\s*\\.\\s*(?:off|removeListener|removeEventListener|once)\\s*\\(`).test(text);
          if (!removed) out.push({ kind: "listener-per-request", file: path, line: lineOf(n), message: `a listener is added to ${recv} on every request and never removed (line ${lineOf(n)})` });
        }
      } else if (ts.isIdentifier(callee) && callee.text === "setInterval" && nextDepth >= 1 && !clearIntervalPresent) {
        out.push({ kind: "timer-per-call", file: path, line: lineOf(n), message: `a repeating timer is started inside a function and nothing in the file stops it (line ${lineOf(n)})` });
      }
    }
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && ["Pool", "Client", "PrismaClient", "Redis", "MongoClient"].includes(n.expression.text) && nextHandler && nextDepth >= 1) {
      out.push({ kind: "connection-per-request", file: path, line: lineOf(n), message: `a new ${n.expression.text} is created inside a request handler (line ${lineOf(n)}): one set of connections per request` });
    }
    // reassignment or a size check counts as a limit
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = unwrap(n.left);
      if (ts.isIdentifier(l) && collections.has(l.text)) bounded.add(l.text);
      if (ts.isPropertyAccessExpression(l) && l.name.text === "length" && ts.isIdentifier(unwrap(l.expression))) bounded.add((unwrap(l.expression) as ts.Identifier).text);
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = unwrap(n.left);
      if (ts.isElementAccessExpression(l) && ts.isIdentifier(unwrap(l.expression)) && collections.has((unwrap(l.expression) as ts.Identifier).text) && nextDepth >= 1) {
        const name = (unwrap(l.expression) as ts.Identifier).text;
        if (!growth.has(name)) growth.set(name, lineOf(n));
      }
    }
    if (ts.isPropertyAccessExpression(n) && (n.name.text === "size" || n.name.text === "length") && ts.isIdentifier(unwrap(n.expression)) && collections.has((unwrap(n.expression) as ts.Identifier).text)) {
      bounded.add((unwrap(n.expression) as ts.Identifier).text);
    }
    // a connection checked out of a pool
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && nextFn) {
      const init = unwrap(n.initializer);
      if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(unwrap(init.expression)) && (unwrap(init.expression) as ts.PropertyAccessExpression).name.text === "connect" && init.arguments.length === 0) {
        const recv = (unwrap(init.expression) as ts.PropertyAccessExpression).expression.getText(sf);
        if (/pool/i.test(recv) && nextFn.body && !new RegExp(`\\b${n.name.text}\\s*\\.\\s*release\\s*\\(`).test(nextFn.body.getText(sf))) {
          out.push({ kind: "connection-not-released", file: path, line: lineOf(n), message: `${n.name.text} is taken from ${recv} (line ${lineOf(n)}) and release() is never called in the same function` });
        }
      }
    }
    ts.forEachChild(n, (c) => walk(c, nextDepth, nextHandler, nextFn));
  };
  walk(sf, 0, false, null);

  for (const [name, line] of growth) {
    if (bounded.has(name)) continue;
    out.push({ kind: "unbounded-collection", file: path, line, message: `${name} (a ${collections.get(name)} at the top of the file) is added to inside a function (line ${line}) and nothing ever removes from it or limits it: memory grows with every call` });
  }
  return out.sort((a, b) => a.line - b.line);
}

// ── measuring ───────────────────────────────────────────────────────────────

export interface MemorySample {
  /** Requests made so far. */
  requests: number;
  mb: number;
}

export interface GrowthVerdict {
  leak: boolean;
  slopeMbPer1000: number;
  r2: number;
  growthMb: number;
  samples: number;
  reason: string;
}

export function detectGrowth(samples: MemorySample[], opts: { minSlopeMbPer1000?: number; minR2?: number } = {}): GrowthVerdict {
  const minSlope = opts.minSlopeMbPer1000 ?? 0.5;
  const minR2 = opts.minR2 ?? 0.6;
  const empty = { slopeMbPer1000: 0, r2: 0, growthMb: 0, samples: samples.length };
  if (samples.length < 6) return { leak: false, ...empty, reason: `not enough measurements (${samples.length}; at least 6 needed)` };
  const kept = samples.slice(Math.floor(samples.length * 0.25));
  const n = kept.length;
  const mx = kept.reduce((s, p) => s + p.requests, 0) / n;
  const my = kept.reduce((s, p) => s + p.mb, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of kept) {
    sxy += (p.requests - mx) * (p.mb - my);
    sxx += (p.requests - mx) ** 2;
    syy += (p.mb - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  const third = Math.max(1, Math.floor(n / 3));
  const mean = (xs: MemorySample[]) => xs.reduce((s, p) => s + p.mb, 0) / xs.length;
  const first = mean(kept.slice(0, third));
  const growthMb = mean(kept.slice(-third)) - first;
  const slopeMbPer1000 = slope * 1000;
  const needGrowth = Math.max(0.5, first * 0.01);
  const leak = slopeMbPer1000 >= minSlope && r2 >= minR2 && growthMb >= needGrowth;
  const reason = leak
    ? `memory rises about ${slopeMbPer1000.toFixed(1)} MB per 1000 requests (fit ${r2.toFixed(2)}), ${growthMb.toFixed(1)} MB over the run`
    : slopeMbPer1000 < minSlope
      ? "memory is level or falling"
      : r2 < minR2
        ? "memory goes up and down without a steady rise"
        : "the rise is within normal variation";
  return { leak, slopeMbPer1000, r2, growthMb, samples: samples.length, reason };
}

export interface RouteTiming {
  count: number;
  errors: number;
  p50: number;
  p95: number;
}

export interface LeakProbeOptions {
  baseUrl: string;
  /** Paths to call with GET. */
  routes: string[];
  rounds?: number;
  requestsPerRound?: number;
  fetchFn?: typeof fetch;
  /** Memory of the app in MB, read after each round. */
  readMemoryMb: () => Promise<number>;
  settleMs?: number;
  /** The clock used for timings, in milliseconds. Default: performance.now. */
  now?: () => number;
}

export interface LeakProbeResult {
  samples: MemorySample[];
  verdict: GrowthVerdict;
  timings: Record<string, RouteTiming>;
}

const pct = (sorted: number[], p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!);

/** Calls the routes with GET again and again, reading memory after each round. */
export async function runLeakProbe(opts: LeakProbeOptions): Promise<LeakProbeResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? (() => performance.now());
  const rounds = opts.rounds ?? 10;
  const perRound = opts.requestsPerRound ?? 50;
  const durations: Record<string, number[]> = {};
  const errors: Record<string, number> = {};
  for (const r of opts.routes) (durations[r] = [], (errors[r] = 0));
  const samples: MemorySample[] = [];
  let requests = 0;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < perRound; i++) {
      const route = opts.routes[requests % opts.routes.length]!;
      const t0 = now();
      try {
        const res = await fetchFn(opts.baseUrl.replace(/\/$/, "") + route, { method: "GET" });
        await res.arrayBuffer();
        if (!res.ok) errors[route]!++;
      } catch {
        errors[route]!++;
      }
      durations[route]!.push(now() - t0);
      requests++;
    }
    if (opts.settleMs) await new Promise((r) => setTimeout(r, opts.settleMs));
    samples.push({ requests, mb: await opts.readMemoryMb() });
  }
  const timings: Record<string, RouteTiming> = {};
  for (const r of opts.routes) {
    const sorted = [...durations[r]!].sort((a, b) => a - b);
    timings[r] = { count: sorted.length, errors: errors[r]!, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95) };
  }
  return { samples, verdict: detectGrowth(samples), timings };
}
