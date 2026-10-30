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
  // ESM-style TypeScript imports name the compiled file: './routes/tasks.js' is routes/tasks.ts (test9003).
  const ts_ = base.replace(/\.(m?)js(x?)$/, ".$1ts$2");
  for (const c of [base, ...(ts_ !== base ? [ts_] : []), `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, join(base, "index.ts"), join(base, "index.tsx"), join(base, "index.js")]) {
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
    if (nb && ts.isNamespaceImport(nb)) imports.set(nb.name.text, { file, name: "*" });
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
function sqlTextsOf(arg: ts.Expression, sf: ts.SourceFile, scope: ts.Node): Array<{ text: string; dynamic: boolean; holes: ts.Expression[] }> {
  const holes: ts.Expression[] = [];
  /** list.join(sep), where every value pushed to the list in this function is a fixed string: the joined text. */
  const joined = (x: ts.Expression): { text: string; dynamic: boolean } | null => {
    if (!(ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "join" && ts.isIdentifier(x.expression.expression))) return null;
    const list = x.expression.expression.text;
    const sep = x.arguments[0] && ts.isStringLiteral(x.arguments[0]) ? x.arguments[0].text : ",";
    const pushed: Array<{ text: string; dynamic: boolean } | null> = [];
    visit(scope, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "push" && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === list) {
        for (const a of n.arguments) pushed.push(one(a));
      }
    });
    if (pushed.length > 0 && pushed.every((p) => p && !p.dynamic)) return { text: pushed.map((p) => p!.text).join(sep), dynamic: false };
    holes.push(x);
    return { text: "${…}", dynamic: true };
  };
  const one = (e: ts.Expression): { text: string; dynamic: boolean } | null => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { text: e.text, dynamic: false };
    // "price = $" + (i++): strings joined with +, where a value right after "$" is a parameter number (shopbill-9).
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = one(e.left);
      if (!left) return { text: e.getText(sf), dynamic: true };
      const right = one(e.right) ?? joined(e.right);
      if (right) return { text: left.text + right.text, dynamic: left.dynamic || right.dynamic };
      if (left.text.endsWith("$")) return { text: `${left.text}1`, dynamic: left.dynamic };
      holes.push(e.right);
      return { text: `${left.text}\${…}`, dynamic: true };
    }
    if (ts.isParenthesizedExpression(e)) return one(e.expression);
    if (ts.isBinaryExpression(e)) {
      holes.push(e);
      return { text: e.getText(sf), dynamic: true };
    }
    if (!ts.isTemplateExpression(e)) return null;
    let text = e.head.text;
    let dynamic = false;
    for (const span of e.templateSpans) {
      const x = span.expression;
      if (text.endsWith("$")) {
        text += "1"; // a parameter number: the value is passed separately
      } else {
        const j = joined(x);
        if (j) {
          text += j.text;
          dynamic ||= j.dynamic;
        } else {
          holes.push(x);
          text += "${…}";
          dynamic = true;
        }
      }
      text += span.literal.text;
    }
    return { text, dynamic };
  };
  const direct = one(arg);
  if (direct) return [{ ...direct, holes }];
  if (!ts.isIdentifier(arg)) return [];
  const name = arg.text;
  const found: Array<{ text: string; dynamic: boolean; holes: ts.Expression[] }> = [];
  const collect = (root: ts.Node) =>
    visit(root, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
        const before = holes.length;
        const s = one(n.initializer);
        if (s) found.push({ ...s, holes: holes.slice(before) });
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && n.left.text === name) {
        const before = holes.length;
        const s = one(n.right);
        if (s) found.push({ ...s, holes: holes.slice(before) });
      }
    });
  collect(scope);
  if (found.length === 0 && scope !== sf) collect(sf);
  return found;
}

/**
 * Whether values come from the request (taint analysis, patent claim 8; 2026-10-30): the expressions, and every variable they
 * use, followed through the function's declarations, assignments, list pushes and loops, four steps deep. True when any of it
 * reads req.body, req.query, req.params or req.headers.
 * Only what can become the value is followed (the recorded task builds, where 5 of 5 first findings were false): the branches of
 * `a ? b : c` but not its test, a comparison (a true/false), a number conversion, a lookup in a fixed map of literals, and a
 * variable the function checks against a fixed list (`SORTS.includes(x)`) carry no request text.
 */
const FROM_REQUEST = /\breq(?:uest)?\.(?:body|query|params|headers)\b/;
const NUMBER_FNS = new Set(["parseInt", "parseFloat", "Number", "Math", "isNaN"]);
const TEXT_KEEPING = new Set(["toUpperCase", "toLowerCase", "trim", "toString", "String"]);

interface FixedFacts {
  /** names declared as an object or array literal of literals only */
  fixed: Set<string>;
  /** the file's functions by name: what they return */
  returns: Map<string, ts.Expression[]>;
}

/** Names declared anywhere in the file as an object or array literal of literals only, and what the file's functions return. */
function fixedFacts(sf: ts.SourceFile): FixedFacts {
  const returns = new Map<string, ts.Expression[]>();
  const returnsOf = (fn: ts.Node) => {
    const out: ts.Expression[] = [];
    if ((ts.isArrowFunction(fn)) && !ts.isBlock(fn.body)) out.push(fn.body);
    visit(fn, (n) => { if (ts.isReturnStatement(n) && n.expression) out.push(n.expression); });
    return out;
  };
  visit(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) returns.set(n.name.text, returnsOf(n));
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) returns.set(n.name.text, returnsOf(n.initializer));
  });
  return { fixed: fixedConstants(sf), returns };
}

function fixedConstants(sf: ts.SourceFile): Set<string> {
  const isFixed = (e: ts.Expression): boolean => {
    if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e)) return true;
    if (ts.isAsExpression(e) || ts.isParenthesizedExpression(e)) return isFixed(e.expression);
    if (ts.isArrayLiteralExpression(e)) return e.elements.every((x) => isFixed(x as ts.Expression));
    if (ts.isObjectLiteralExpression(e)) return e.properties.every((p) => ts.isPropertyAssignment(p) && isFixed(p.initializer));
    return false;
  };
  const out = new Set<string>();
  visit(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrayLiteralExpression(n.initializer) || ts.isObjectLiteralExpression(n.initializer) || ts.isAsExpression(n.initializer)) && isFixed(n.initializer)) out.add(n.name.text);
  });
  return out;
}

/** The variable at the root of `x`, `x.toLowerCase()`, `String(x)`. */
function rootName(e: ts.Expression): string | null {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return rootName(e.expression);
  if (ts.isCallExpression(e)) {
    if (ts.isPropertyAccessExpression(e.expression) && TEXT_KEEPING.has(e.expression.name.text)) return rootName(e.expression.expression);
    if (ts.isIdentifier(e.expression) && e.expression.text === "String" && e.arguments[0]) return rootName(e.arguments[0]);
  }
  return null;
}

/** The parts of `e` whose value can become the value of `e`. */
function valueParts(e: ts.Expression, ff: FixedFacts, depth = 0): ts.Expression[] {
  const fixed = ff.fixed;
  if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return [];
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) return valueParts(e.expression, ff, depth);
  if (ts.isConditionalExpression(e)) return [...valueParts(e.whenTrue, ff, depth), ...valueParts(e.whenFalse, ff, depth)];
  if (ts.isPrefixUnaryExpression(e) || ts.isTypeOfExpression(e)) return [];
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.PlusToken) return [...valueParts(e.left, ff, depth), ...valueParts(e.right, ff, depth)];
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) return valueParts(e.right, ff, depth);
    return []; // comparisons, arithmetic other than +: a true/false or a number
  }
  if (ts.isTemplateExpression(e)) return e.templateSpans.flatMap((sp) => valueParts(sp.expression, ff, depth));
  if (ts.isElementAccessExpression(e) && ts.isIdentifier(e.expression) && fixed.has(e.expression.text)) return [];
  if (ts.isCallExpression(e)) {
    const callee = e.expression;
    if (ts.isIdentifier(callee) && NUMBER_FNS.has(callee.text)) return [];
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Math") return [];
    if (ts.isIdentifier(callee) && callee.text === "String") return e.arguments.flatMap((a) => valueParts(a, ff, depth));
    if (ts.isPropertyAccessExpression(callee) && TEXT_KEEPING.has(callee.name.text)) return valueParts(callee.expression, ff, depth);
    // A same-file function whose every return value is fixed text (stress6qafix: getOrderByClause returns ORDER_BY_MAP[x] || "...").
    const rets = ts.isIdentifier(callee) ? ff.returns.get(callee.text) : undefined;
    if (rets && rets.length > 0 && depth < 3 && rets.every((r) => valueParts(r, ff, depth + 1).length === 0)) return [];
  }
  return [e];
}

export function fromRequest(exprs: ts.Node[], scope: ts.Node, sf: ts.SourceFile): boolean {
  const ff = fixedFacts(sf);
  const fixed = ff.fixed;
  // Variables the function checks against a fixed list: `SORTS.includes(x)`, `["a", "b"].includes(x.toLowerCase())`.
  const checked = new Set<string>();
  visit(scope, (n) => {
    if (!(ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "includes" && n.arguments[0])) return;
    const list = n.expression.expression;
    const isFixedList = (ts.isIdentifier(list) && fixed.has(list.text)) || (ts.isArrayLiteralExpression(list) && list.elements.every((x) => ts.isStringLiteralLike(x)));
    const name = rootName(n.arguments[0]);
    if (isFixedList && name) checked.add(name);
  });
  const seen = new Set<string>();
  let frontier = exprs.flatMap((e) => (ts.isExpression(e) ? valueParts(e, ff) : [e]));
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const names: string[] = [];
    for (const e of frontier) {
      if (FROM_REQUEST.test(e.getText(sf))) return true;
      visit(e, (n) => {
        if (ts.isIdentifier(n) && !seen.has(n.text) && !checked.has(n.text)) {
          seen.add(n.text);
          names.push(n.text);
        }
      });
    }
    const declares = (n: ts.Node) => {
      const ids: string[] = [];
      visit(n, (x) => { if (ts.isIdentifier(x)) ids.push(x.text); });
      return ids.some((id) => names.includes(id));
    };
    const next: ts.Node[] = [];
    const add = (e: ts.Expression) => next.push(...valueParts(e, ff));
    visit(scope, (n) => {
      if (ts.isVariableDeclaration(n) && n.initializer && declares(n.name)) add(n.initializer);
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && names.includes(n.left.text)) add(n.right);
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "push" && ts.isIdentifier(n.expression.expression) && names.includes(n.expression.expression.text)) n.arguments.forEach(add);
      if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && declares(n.initializer)) add(n.expression);
    });
    frontier = next;
  }
  return false;
}

/** For an INSERT or UPDATE with its values given as an array: the columns whose value comes from the request. */
function writesFromRequest(text: string, values: ts.Expression | undefined, scope: ts.Node, sf: ts.SourceFile, table: string): string[] {
  if (!values || !ts.isArrayLiteralExpression(values)) return [];
  const ins = text.match(/INSERT\s+INTO\s+"?\w+"?\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i);
  const pairs: Array<[string, string]> = ins
    ? ins[1]!.split(",").map((c, i) => [c.trim().replace(/"/g, ""), (ins[2]!.split(",")[i] ?? "").trim()])
    : [...text.matchAll(/("?\w+"?)\s*=\s*(\$\d+)/g)].map((m) => [m[1]!.replace(/"/g, ""), m[2]!]);
  const out: string[] = [];
  for (const [col, val] of pairs) {
    const n = val.match(/^\$(\d+)$/)?.[1];
    const el = n ? values.elements[Number(n) - 1] : undefined;
    if (el && fromRequest([el], scope, sf)) out.push(`${table}.${col}`);
  }
  return out;
}

// ── Backend ─────────────────────────────────────────────────────────────────

export interface SqlUse {
  file: string;
  line: number;
  function: string;
  text: string;
  facts: QueryFacts;
  /** SQL built from values: whether those values come from the request (null when it is not built from values) */
  fromRequest: boolean | null;
  /** columns written with a value that comes from the request */
  writesFromRequest: string[];
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
  /** the handler's own code answers 401 (it checks sign-in itself, test9005); null when the handler was not found */
  answers401: boolean | null;
  /** the handler's own code answers 403 (it checks the caller's role or ownership itself) */
  answers403: boolean | null;
}

export interface BackendFacts {
  endpoints: EndpointFacts[];
  sql: SqlUse[];
  notes: string[];
}

const unwrap = (e: ts.Expression): ts.Expression => (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) ? unwrap(e.expression) : e);

// Body parsers, CORS, headers and loggers run for every request and decide nothing about who may call a route.
const INFRA_MW = /^(express\.|cors\(|helmet\(|morgan\(|cookieParser\(|compression\()/;

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);

export function readBackend(backendDir: string): BackendFacts {
  const projectRoot = dirname(backendDir);
  const files = walk(join(backendDir, "src"), /\.(ts|js)$/).map((f) => parse(f, projectRoot, null));
  const byAbs = new Map(files.map((p) => [p.abs, p]));
  const notes: string[] = [];
  const sql: Array<SqlUse & { node: ts.Node; parsed: Parsed }> = [];
  type Route = { p: Parsed; method: string; path: string; line: number; args: ts.Expression[]; obj: string; pos: number };
  // 2026-10-30 (Brewline 3: router.use(requireAuth) before the routes): middleware at the router and at the mount counts too.
  const routerMw: Array<{ file: string; obj: string; name: string; pos: number }> = [];
  const routes: Route[] = [];
  const mounts: Array<{ from: string; prefix: string; to: string; mw: string[] }> = [];
  const roots = new Set<string>();
  // use() calls are sorted once every file is read: a mount when the last argument is a router file, otherwise middleware.
  const uses: Array<{ p: Parsed; obj: string; prefix: string; rest: ts.Expression[]; to: string | null; pos: number }> = [];

  for (const p of files) {
    visit(p.sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      if (ts.isIdentifier(n.expression) && n.expression.text === "express") roots.add(p.abs);
      if (!ts.isPropertyAccessExpression(n.expression)) return;
      const name = n.expression.name.text;
      const [a0] = n.arguments;
      if (ROUTE_METHODS.has(name) && a0 && ts.isStringLiteral(a0) && n.arguments.length >= 2) {
        routes.push({ p, method: name.toUpperCase(), path: a0.text, line: lineOf(p.sf, n), args: n.arguments.slice(1).map(unwrap), obj: n.expression.expression.getText(p.sf), pos: n.pos });
      } else if (name === "use") {
        const prefix = a0 && ts.isStringLiteral(a0) ? a0.text : "";
        const rest = n.arguments.slice(a0 && ts.isStringLiteral(a0) ? 1 : 0).map(unwrap);
        const mwName = (a: ts.Expression) => (ts.isIdentifier(a) ? a.text : a.getText(p.sf).slice(0, 40));
        const target = rest[rest.length - 1];
        const imp = target && ts.isIdentifier(target) ? p.imports.get(target.text) : undefined;
        uses.push({ p, obj: n.expression.expression.getText(p.sf), prefix, rest, to: imp?.file && byAbs.has(imp.file) ? imp.file : null, pos: n.pos });
      } else if (name === "query" && a0) {
        const variants = sqlTextsOf(a0, p.sf, enclosingFunction(n) ?? p.sf);
        if (variants.length === 0) {
          notes.push(`${p.rel}:${lineOf(p.sf, n)}: the SQL of this query is not a string the map can read (${a0.getText(p.sf).slice(0, 60)})`);
          return;
        }
        const scope = enclosingFunction(n) ?? p.sf;
        for (const v of variants) {
          const facts = queryFacts(v.text, { dynamic: v.dynamic });
          const table = facts.tables[0]?.table ?? "";
          sql.push({
            file: p.rel, line: lineOf(p.sf, n), function: enclosingName(n), text: v.text, facts,
            fromRequest: v.dynamic ? fromRequest(v.holes, scope, p.sf) : null,
            writesFromRequest: facts.kind === "insert" || facts.kind === "update" ? writesFromRequest(v.text, n.arguments[1], scope, p.sf, table) : [],
            node: n, parsed: p,
          });
        }
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
  // 2026-10-30 (stress-verify: `router.use(requireAuth)` with requireAuth imported from ../middleware was read as a mount):
  // only a file that defines routes or mounts is a router.
  const routerFiles = new Set(routes.map((r) => r.p.abs));
  for (const u of uses) if (u.to && u.prefix) routerFiles.add(u.p.abs);
  for (const u of uses) {
    const to = u.to ? definingFile(u.to) : null;
    const mwName = (a: ts.Expression) => (ts.isIdentifier(a) ? a.text : a.getText(u.p.sf).slice(0, 40));
    if (to && (routerFiles.has(to) || uses.some((x) => x.p.abs === to && x.to))) mounts.push({ from: u.p.abs, prefix: u.prefix, to, mw: u.rest.slice(0, -1).map(mwName) });
    else if (!u.prefix) for (const a of u.rest) if ((ts.isIdentifier(a) || ts.isCallExpression(a)) && !INFRA_MW.test(mwName(a))) routerMw.push({ file: u.p.abs, obj: u.obj, name: mwName(a), pos: u.pos });
  }

  // Each router file's path prefix, from the app's own mounts.
  const prefixOf = new Map<string, string>();
  const mwOf = new Map<string, string[]>();
  const queue: Array<[string, string]> = [...roots].map((r) => [r, ""]);
  for (const [r] of queue) prefixOf.set(r, "");
  while (queue.length) {
    const [file, prefix] = queue.shift()!;
    for (const m of mounts.filter((x) => x.from === file)) {
      if (prefixOf.has(m.to)) continue;
      const full = (prefix + m.prefix).replace(/\/+/g, "/");
      prefixOf.set(m.to, full);
      mwOf.set(m.to, [...(mwOf.get(file) ?? []), ...routerMw.filter((x) => x.file === file).map((x) => x.name), ...m.mw]);
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
    // `import * as taskController` … `taskController.getTasksController` (test9004)
    const viaNamespace = ts.isPropertyAccessExpression(last) && ts.isIdentifier(last.expression) && r.p.imports.get(last.expression.text)?.name === "*" ? r.p.imports.get(last.expression.text)! : null;
    if (viaNamespace?.file && byAbs.has(viaNamespace.file) && ts.isPropertyAccessExpression(last)) {
      handler = last.name.text;
      const found = findExport(viaNamespace.file, handler);
      handlerParsed = byAbs.get(found?.file ?? viaNamespace.file)!;
      handlerNode = found?.node;
      if (!handlerNode) notes.push(`${r.p.rel}:${r.line}: the handler ${last.getText(r.p.sf)} of ${r.method} ${r.path} was not found in the app's code`);
    } else if (ts.isIdentifier(last)) {
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
      middleware: [
        ...(mwOf.get(r.p.abs) ?? []),
        ...routerMw.filter((x) => x.file === r.p.abs && x.obj === r.obj && x.pos < r.pos).map((x) => x.name),
        ...r.args.slice(0, -1).map((a) => (ts.isIdentifier(a) ? a.text : a.getText(r.p.sf).slice(0, 40))),
      ],
      sql: [...new Set(used)].map(({ node: _n, parsed: _p, ...q }) => q),
      answers401: handlerNode ? nodes.some((fn) => /\b401\b/.test(fn.getText(handlerParsed.sf))) : null,
      answers403: handlerNode ? nodes.some((fn) => /\b403\b/.test(fn.getText(handlerParsed.sf))) : null,
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

/** A Next.js route handler: app/api/x/route.ts exporting GET, POST… — an endpoint the frontend serves itself. */
export interface RouteHandler {
  method: string;
  path: string;
  file: string;
}

export function readFrontend(frontendDir: string): { pages: PageFacts[]; handlers: RouteHandler[]; notes: string[] } {
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
      // A value joined straight onto the path, not after a "/", is the query string (f00dface0042: `/api/v1/tasks${query}`).
      const path = s.text.slice(s.text.indexOf("/api/")).split(/[?#]/)[0]!.replace(/(?<!\/):param.*$/, "");
      let method = viaMethod && ROUTE_METHODS.has(viaMethod) ? viaMethod.toUpperCase() : "GET";
      const opts = n.arguments[viaMethod && ROUTE_METHODS.has(viaMethod) ? 2 : 1] ?? n.arguments[1];
      if (opts && ts.isObjectLiteralExpression(opts)) {
        for (const prop of opts.properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText(p.sf) === "method" && ts.isStringLiteral(prop.initializer)) method = prop.initializer.text.toUpperCase();
        }
      }
      // request(path, "POST", body) (f00dface0042): the method as its own argument.
      if (!(viaMethod && ROUTE_METHODS.has(viaMethod))) {
        const given = n.arguments.slice(1, 3).find((a) => ts.isStringLiteral(a) && ROUTE_METHODS.has(a.text.toLowerCase()));
        if (given && ts.isStringLiteral(given)) method = given.text.toUpperCase();
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
  // 2026-10-30 (verify361300, stress-retry: /api/auth/token is served by frontend/app/api/auth/token/route.ts).
  const handlers: RouteHandler[] = [];
  for (const abs of walk(appDir, /^route\.(ts|js)$/)) {
    const segs = relative(appDir, dirname(abs)).replace(/\\/g, "/").split("/").filter((s) => s && !/^\(.*\)$/.test(s));
    const path = `/${segs.map((s) => (/^\[.*\]$/.test(s) ? ":param" : s)).join("/")}`;
    const p = get(abs);
    for (const st of p.sf.statements) {
      const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      const names = ts.isFunctionDeclaration(st) && st.name ? [st.name.text] : ts.isVariableStatement(st) ? st.declarationList.declarations.map((d) => d.name.getText(p.sf)) : [];
      for (const m of names) if (ROUTE_METHODS.has(m.toLowerCase()) && m === m.toUpperCase()) handlers.push({ method: m, path, file: p.rel });
    }
  }
  return { pages: pages.sort((a, b) => a.route.localeCompare(b.route)), handlers, notes: [] };
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
