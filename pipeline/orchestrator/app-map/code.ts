// The app map's code reader (2026-10-30, understanding plan step 2). The generated code is read from its syntax tree with
// the TypeScript compiler — no model, no text search: the backend's router mounts give each endpoint its full path; each
// endpoint's handler (in its own file or imported) and the functions it calls give the SQL it runs; the frontend's page
// folders give each page's route, and the components a page imports give the API calls it makes; the Drizzle schema
// gives the columns it declares. Test files are not the app. What cannot be read is reported, not guessed.
import ts from "typescript";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { queryFacts, type QueryFacts } from "./sql.ts";

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", "nexui", "__tests__"]);
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (SKIP_DIRS.has(n)) continue;
    const full = join(dir, n);
    try {
      if (statSync(full).isDirectory()) out.push(...walk(full, exts));
      else if (exts.test(n) && !TEST_FILE.test(n)) out.push(full);
    } catch {
      /* unreadable: skipped */
    }
  }
  return out;
}

interface Parsed {
  abs: string;
  rel: string;
  sf: ts.SourceFile;
  /** local name → the file it is imported from (null for a package) and the name exported there */
  imports: Map<string, { file: string | null; name: string }>;
}

function resolveModule(fromAbs: string, spec: string, aliasRoot: string | null): string | null {
  let base: string | null = null;
  if (spec.startsWith(".")) base = resolve(dirname(fromAbs), spec);
  else if (spec.startsWith("@/") && aliasRoot) base = join(aliasRoot, spec.slice(2));
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, join(base, "index.ts"), join(base, "index.tsx"), join(base, "index.js")]) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch {
      /* not this one */
    }
  }
  return null;
}

function parse(abs: string, projectRoot: string, aliasRoot: string | null): Parsed {
  const text = readFileSync(abs, "utf-8");
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, abs.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Map<string, { file: string | null; name: string }>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
    const file = resolveModule(abs, st.moduleSpecifier.text, aliasRoot);
    if (st.importClause.name) imports.set(st.importClause.name.text, { file, name: "default" });
    const nb = st.importClause.namedBindings;
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imports.set(el.name.text, { file, name: (el.propertyName ?? el.name).text });
  }
  return { abs, rel: relative(projectRoot, abs).replace(/\\/g, "/"), sf, imports };
}

const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (c) => visit(c, fn));
}

/** The text of a string-like argument; a template's substitutions become `sub`. */
function stringOf(node: ts.Node, sub: string): { text: string; dynamic: boolean } | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, dynamic: false };
  if (ts.isTemplateExpression(node)) return { text: node.head.text + node.templateSpans.map((s) => sub + s.literal.text).join(""), dynamic: true };
  return null;
}

/** Named functions of a file: function declarations and consts whose value is a function. */
function namedFunctions(p: Parsed): Map<string, ts.Node> {
  const fns = new Map<string, ts.Node>();
  visit(p.sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, n);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) fns.set(n.name.text, n.initializer);
  });
  return fns;
}

/** The name of the function a node is in (the outermost named one in the file), or "(top level)". */
function enclosingName(node: ts.Node): string {
  let name = "(top level)";
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) name = n.name.text;
    else if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) name = n.parent.name.text;
    else if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent && ts.isCallExpression(n.parent)) name = "(inline)";
    else if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) name = n.name.text;
  }
  return name;
}

/** The nearest function a node is inside, or undefined at the top level. */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)) return n;
  }
  return undefined;
}

/**
 * The SQL text a query argument can hold, read from the code (2026-10-30, Brewline 3's real code):
 *   - a string, or a template whose substitutions are parameter numbers (`$${i++}` → `$1`);
 *   - a template that joins a list built in the same function from fixed strings (`fields.push(\`price = $${i++}\`)`,
 *     then `${fields.join(", ")}`): the strings are put in, so the columns are read and the values stay parameters;
 *   - a variable: each string it is given in the same function (an if/else gives two variants), or a constant of the file.
 * Any other substitution stays `${…}` and marks the SQL as built from values.
 */
function sqlTextsOf(arg: ts.Expression, sf: ts.SourceFile, scope: ts.Node): Array<{ text: string; dynamic: boolean }> {
  const one = (e: ts.Expression): { text: string; dynamic: boolean } | null => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { text: e.text, dynamic: false };
    // "price = $" + (i++): strings joined with +, where a value right after "$" is a parameter number (shopbill-9).
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = one(e.left);
      if (!left) return { text: e.getText(sf), dynamic: true };
      const right = one(e.right);
      if (right) return { text: left.text + right.text, dynamic: left.dynamic || right.dynamic };
      if (left.text.endsWith("$")) return { text: `${left.text}1`, dynamic: left.dynamic };
      return { text: `${left.text}\${…}`, dynamic: true };
    }
    if (ts.isParenthesizedExpression(e)) return one(e.expression);
    if (ts.isBinaryExpression(e)) return { text: e.getText(sf), dynamic: true };
    if (!ts.isTemplateExpression(e)) return null;
    let text = e.head.text;
    let dynamic = false;
    for (const span of e.templateSpans) {
      const x = span.expression;
      if (text.endsWith("$")) {
        text += "1"; // a parameter number: the value is passed separately
      } else if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "join" && ts.isIdentifier(x.expression.expression)) {
        const list = x.expression.expression.text;
        const sep = x.arguments[0] && ts.isStringLiteral(x.arguments[0]) ? x.arguments[0].text : ",";
        const pushed: Array<{ text: string; dynamic: boolean } | null> = [];
        visit(scope, (n) => {
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "push" && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === list) {
            for (const a of n.arguments) pushed.push(one(a));
          }
        });
        if (pushed.length > 0 && pushed.every((s) => s && !s.dynamic)) text += pushed.map((s) => s!.text).join(sep);
        else {
          text += "${…}";
          dynamic = true;
        }
      } else {
        text += "${…}";
        dynamic = true;
      }
      text += span.literal.text;
    }
    return { text, dynamic };
  };
  const direct = one(arg);
  if (direct) return [direct];
  if (!ts.isIdentifier(arg)) return [];
  const name = arg.text;
  const found: Array<{ text: string; dynamic: boolean }> = [];
  const collect = (root: ts.Node) =>
    visit(root, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
        const s = one(n.initializer);
        if (s) found.push(s);
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && n.left.text === name) {
        const s = one(n.right);
        if (s) found.push(s);
      }
    });
  collect(scope);
  if (found.length === 0 && scope !== sf) collect(sf);
  return found;
}

// ── Backend ─────────────────────────────────────────────────────────────────

export interface SqlUse {
  file: string;
  line: number;
  function: string;
  text: string;
  facts: QueryFacts;
}

export interface EndpointFacts {
  method: string;
  path: string;
  file: string;
  line: number;
  handler: string;
  handlerFile: string;
  middleware: string[];
  sql: SqlUse[];
}

export interface BackendFacts {
  endpoints: EndpointFacts[];
  sql: SqlUse[];
  notes: string[];
}

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);

export function readBackend(backendDir: string): BackendFacts {
  const projectRoot = dirname(backendDir);
  const files = walk(join(backendDir, "src"), /\.(ts|js)$/).map((f) => parse(f, projectRoot, null));
  const byAbs = new Map(files.map((p) => [p.abs, p]));
  const notes: string[] = [];
  const sql: Array<SqlUse & { node: ts.Node; parsed: Parsed }> = [];
  type Route = { p: Parsed; method: string; path: string; line: number; args: ts.Expression[] };
  const routes: Route[] = [];
  const mounts: Array<{ from: string; prefix: string; to: string }> = [];
  const roots = new Set<string>();

  for (const p of files) {
    visit(p.sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      if (ts.isIdentifier(n.expression) && n.expression.text === "express") roots.add(p.abs);
      if (!ts.isPropertyAccessExpression(n.expression)) return;
      const name = n.expression.name.text;
      const [a0, a1] = n.arguments;
      if (ROUTE_METHODS.has(name) && a0 && ts.isStringLiteral(a0) && n.arguments.length >= 2) {
        routes.push({ p, method: name.toUpperCase(), path: a0.text, line: lineOf(p.sf, n), args: [...n.arguments.slice(1)] });
      } else if (name === "use") {
        const prefix = a0 && ts.isStringLiteral(a0) ? a0.text : "";
        const target = a0 && ts.isStringLiteral(a0) ? a1 : a0;
        if (target && ts.isIdentifier(target)) {
          const imp = p.imports.get(target.text);
          if (imp?.file && byAbs.has(imp.file)) mounts.push({ from: p.abs, prefix, to: imp.file });
        }
      } else if (name === "query" && a0) {
        const variants = sqlTextsOf(a0, p.sf, enclosingFunction(n) ?? p.sf);
        if (variants.length === 0) {
          notes.push(`${p.rel}:${lineOf(p.sf, n)}: the SQL of this query is not a string the map can read (${a0.getText(p.sf).slice(0, 60)})`);
          return;
        }
        for (const s of variants) sql.push({ file: p.rel, line: lineOf(p.sf, n), function: enclosingName(n), text: s.text, facts: queryFacts(s.text, { dynamic: s.dynamic }), node: n, parsed: p });
      }
    });
  }

  // A file that only re-exports a router defined elsewhere (`import plantRouter from "./plants"; export default plantRouter`,
  // Leafkeeper) is mounted where that router is defined.
  const definingFile = (abs: string, depth = 0): string => {
    const p = byAbs.get(abs);
    if (!p || depth > 3) return abs;
    for (const st of p.sf.statements) {
      if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) {
        const imp = p.imports.get(st.expression.text);
        if (imp?.file && byAbs.has(imp.file)) return definingFile(imp.file, depth + 1);
      }
      if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) && st.exportClause && ts.isNamedExports(st.exportClause) && st.exportClause.elements.some((e) => e.name.text === "default")) {
        const to = resolveModule(p.abs, st.moduleSpecifier.text, null);
        if (to && byAbs.has(to)) return definingFile(to, depth + 1);
      }
    }
    return abs;
  };
  for (const m of mounts) m.to = definingFile(m.to);

  // Each router file's path prefix, from the app's own mounts.
  const prefixOf = new Map<string, string>();
  const queue: Array<[string, string]> = [...roots].map((r) => [r, ""]);
  for (const [r] of queue) prefixOf.set(r, "");
  while (queue.length) {
    const [file, prefix] = queue.shift()!;
    for (const m of mounts.filter((x) => x.from === file)) {
      if (prefixOf.has(m.to)) continue;
      const full = (prefix + m.prefix).replace(/\/+/g, "/");
      prefixOf.set(m.to, full);
      queue.push([m.to, full]);
    }
  }

  const fnsOf = new Map(files.map((p) => [p.abs, namedFunctions(p)]));
  /** Every node of the functions reachable from `start` in its file (it, and the same-file functions it calls). */
  const reachable = (p: Parsed, start: ts.Node): ts.Node[] => {
    const fns = fnsOf.get(p.abs)!;
    const seen: ts.Node[] = [start];
    for (let i = 0; i < seen.length && i < 20; i++) {
      visit(seen[i]!, (n) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          const f = fns.get(n.expression.text);
          if (f && !seen.includes(f)) seen.push(f);
        }
      });
    }
    return seen;
  };
  const inside = (outer: ts.Node, n: ts.Node) => n.pos >= outer.pos && n.end <= outer.end;
  /** A function exported by a file, followed through `export * from` and `export { x } from` (Leafkeeper's barrels). */
  const findExport = (abs: string, name: string, depth = 0): { file: string; node: ts.Node } | undefined => {
    const own = fnsOf.get(abs)?.get(name);
    if (own) return { file: abs, node: own };
    const p = byAbs.get(abs);
    if (!p || depth > 4) return undefined;
    for (const st of p.sf.statements) {
      if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const to = resolveModule(p.abs, st.moduleSpecifier.text, null);
      if (!to || !byAbs.has(to)) continue;
      if (!st.exportClause) {
        const hit = findExport(to, name, depth + 1);
        if (hit) return hit;
      } else if (ts.isNamedExports(st.exportClause)) {
        const el = st.exportClause.elements.find((e) => e.name.text === name);
        if (el) return findExport(to, (el.propertyName ?? el.name).text, depth + 1);
      }
    }
    return undefined;
  };

  const endpoints: EndpointFacts[] = [];
  for (const r of routes) {
    const prefix = prefixOf.get(r.p.abs);
    if (prefix === undefined) notes.push(`${r.p.rel}:${r.line}: ${r.method} ${r.path} is in a router the map could not find mounted, so its full path is not known`);
    const last = r.args[r.args.length - 1]!;
    let handler = "(inline)";
    let handlerParsed = r.p;
    let handlerNode: ts.Node | undefined = ts.isArrowFunction(last) || ts.isFunctionExpression(last) ? last : undefined;
    if (ts.isIdentifier(last)) {
      handler = last.text;
      const local = fnsOf.get(r.p.abs)!.get(last.text);
      const imp = r.p.imports.get(last.text);
      if (local) handlerNode = local;
      else if (imp?.file && byAbs.has(imp.file)) {
        handler = imp.name === "default" ? last.text : imp.name;
        const found = findExport(imp.file, handler);
        handlerParsed = byAbs.get(found?.file ?? imp.file)!;
        handlerNode = found?.node;
      }
      if (!handlerNode) notes.push(`${r.p.rel}:${r.line}: the handler ${last.text} of ${r.method} ${r.path} was not found in the app's code`);
    }
    const nodes = handlerNode ? reachable(handlerParsed, handlerNode) : [];
    // The handler's own SQL first, then the SQL of the functions it calls, in the order they were reached.
    const used = nodes.flatMap((fn) => sql.filter((q) => q.parsed === handlerParsed && inside(fn, q.node) && !nodes.some((other) => other !== fn && inside(other, q.node) && inside(fn, other))));
    endpoints.push({
      method: r.method,
      path: `${prefix ?? ""}${r.path === "/" ? "" : r.path}`.replace(/\/+/g, "/") || "/",
      file: r.p.rel,
      line: r.line,
      handler,
      handlerFile: handlerParsed.rel,
      middleware: r.args.slice(0, -1).map((a) => (ts.isIdentifier(a) ? a.text : a.getText(r.p.sf).slice(0, 40))),
      sql: [...new Set(used)].map(({ node: _n, parsed: _p, ...q }) => q),
    });
  }
  return { endpoints, sql: sql.map(({ node: _n, parsed: _p, ...q }) => q), notes };
}

// ── Frontend ────────────────────────────────────────────────────────────────

export interface ApiCall {
  method: string;
  path: string;
  file: string;
  line: number;
}

export interface PageFacts {
  route: string;
  file: string;
  calls: ApiCall[];
}

export function readFrontend(frontendDir: string): { pages: PageFacts[]; notes: string[] } {
  const projectRoot = dirname(frontendDir);
  const parsed = new Map<string, Parsed>();
  const get = (abs: string) => {
    if (!parsed.has(abs)) parsed.set(abs, parse(abs, projectRoot, frontendDir));
    return parsed.get(abs)!;
  };
  // 2026-10-30 (the map on six builds): only a request is an API call — fetch, apiFetch, api.post, axios.get, client.request —
  // not a string check like base.endsWith("/api/v1"); and api.post(path, body) is a POST, whatever its second argument is.
  const REQUEST_FN = /fetch|request|api|http|axios|client/i;
  const callsIn = (p: Parsed): ApiCall[] => {
    const out: ApiCall[] = [];
    visit(p.sf, (n) => {
      if (!ts.isCallExpression(n) || n.arguments.length === 0) return;
      const callee = n.expression;
      const viaMethod = ts.isPropertyAccessExpression(callee) && (ROUTE_METHODS.has(callee.name.text) || /^(request|fetch)$/i.test(callee.name.text)) ? callee.name.text.toLowerCase() : null;
      const named = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (!viaMethod && !REQUEST_FN.test(named)) return;
      const s = stringOf(n.arguments[0]!, ":param");
      if (!s || !s.text.includes("/api/")) return;
      const path = s.text.slice(s.text.indexOf("/api/")).split(/[?#]/)[0]!;
      let method = viaMethod && ROUTE_METHODS.has(viaMethod) ? viaMethod.toUpperCase() : "GET";
      const opts = n.arguments[viaMethod && ROUTE_METHODS.has(viaMethod) ? 2 : 1] ?? n.arguments[1];
      if (opts && ts.isObjectLiteralExpression(opts)) {
        for (const prop of opts.properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText(p.sf) === "method" && ts.isStringLiteral(prop.initializer)) method = prop.initializer.text.toUpperCase();
        }
      }
      out.push({ method, path, file: p.rel, line: lineOf(p.sf, n) });
    });
    return out;
  };
  const appDir = join(frontendDir, "app");
  const pages: PageFacts[] = [];
  for (const abs of walk(appDir, /^page\.(tsx|ts|jsx|js)$/)) {
    const segs = relative(appDir, dirname(abs)).replace(/\\/g, "/").split("/").filter((s) => s && !/^\(.*\)$/.test(s));
    const route = `/${segs.join("/")}`;
    // The page and every local file it imports, transitively.
    const seen = [abs];
    for (let i = 0; i < seen.length && i < 200; i++) {
      for (const imp of get(seen[i]!).imports.values()) {
        if (imp.file && !imp.file.includes(`${"/"}nexui${"/"}`) && !imp.file.includes("\\nexui\\") && !seen.includes(imp.file)) seen.push(imp.file);
      }
    }
    const calls = seen.flatMap((f) => callsIn(get(f)));
    const unique = [...new Map(calls.map((c) => [`${c.method} ${c.path}`, c])).values()];
    pages.push({ route, file: get(abs).rel, calls: unique });
  }
  return { pages: pages.sort((a, b) => a.route.localeCompare(b.route)), notes: [] };
}

// ── The Drizzle schema ──────────────────────────────────────────────────────

/** Tables and column names declared with pgTable in db/src; null when there is no schema file. */
export function readDrizzleSchema(dbDir: string): Record<string, string[]> | null {
  const files = walk(join(dbDir, "src"), /\.ts$/);
  if (files.length === 0) return null;
  const tables: Record<string, string[]> = {};
  for (const abs of files) {
    const p = parse(abs, dirname(dbDir), null);
    visit(p.sf, (n) => {
      if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== "pgTable") return;
      const [nameArg, cols] = n.arguments;
      if (!nameArg || !ts.isStringLiteral(nameArg) || !cols || !ts.isObjectLiteralExpression(cols)) return;
      tables[nameArg.text] = cols.properties.flatMap((prop) => {
        if (!ts.isPropertyAssignment(prop)) return [];
        // The column builder at the root of the chain: uuid("id").primaryKey()… — its first string argument is the name.
        let e: ts.Expression = prop.initializer;
        while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) e = e.expression.expression;
        const first = ts.isCallExpression(e) ? e.arguments[0] : undefined;
        return [first && ts.isStringLiteral(first) ? first.text : prop.name.getText(p.sf)];
      });
    });
  }
  return tables;
}
