// Taint analysis for generated server code (patent claim 8).
//
// Data that comes from the request (body, query, params, headers, cookies, url, and what a route handler reads from `request`)
// is "untrusted". This follows it through assignments, destructuring, string joins, template strings, object and array
// literals, method calls on it, and calls to functions defined in the same file (in both directions: what a function is given
// and what it returns). A finding is reported where untrusted data reaches a dangerous call: SQL text, a shell command, a
// file path, a URL fetched by the server, a redirect, eval, or HTML sent back. Data is cleaned by a number conversion, a
// schema check (parse, safeParse, validate*), escaping/sanitising calls, or path.basename, and an assignment of a safe
// value removes the taint again. A value passed as a query parameter (the second argument) is not part of the SQL text.
//
// Limits (also in docs/patent/build-notes.md): one file at a time; calls into other files are not followed; class methods
// and `this.` calls are not followed; loops are walked once; the request object is recognised only under the names
// `req` and `request`. It reports what it can show a path for; it does not claim the rest is safe.
import ts from "typescript";

export type TaintKind = "sql-injection" | "command-injection" | "code-injection" | "path-traversal" | "ssrf" | "open-redirect" | "xss";

export interface TaintFinding {
  file: string;
  kind: TaintKind;
  cwe: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  source: { description: string; line: number };
  sink: { description: string; line: number };
  /** The variables the data passed through, in order. */
  path: string[];
  message: string;
}

const META: Record<TaintKind, { cwe: string; severity: TaintFinding["severity"]; what: string }> = {
  "sql-injection": { cwe: "CWE-89", severity: "HIGH", what: "SQL text" },
  "command-injection": { cwe: "CWE-78", severity: "CRITICAL", what: "a shell command" },
  "code-injection": { cwe: "CWE-95", severity: "CRITICAL", what: "code that is run" },
  "path-traversal": { cwe: "CWE-22", severity: "HIGH", what: "a file path" },
  ssrf: { cwe: "CWE-918", severity: "HIGH", what: "a URL the server fetches" },
  "open-redirect": { cwe: "CWE-601", severity: "MEDIUM", what: "a redirect target" },
  xss: { cwe: "CWE-79", severity: "MEDIUM", what: "HTML sent to the browser" },
};

interface Taint {
  desc: string;
  line: number;
  chain: string[];
  /** For text that forms a URL: the host part comes from the server, and only a path or query is untrusted. */
  hostSafe?: boolean;
}

const SCHEME_ONLY = /^[a-z][a-z0-9+.-]*:\/*$/i;

const isExit = (s: ts.Statement | undefined): boolean => {
  if (!s) return false;
  if (ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isContinueStatement(s) || ts.isBreakStatement(s)) return true;
  if (ts.isBlock(s)) return s.statements.length > 0 && isExit(s.statements[s.statements.length - 1]);
  if (ts.isIfStatement(s)) return isExit(s.thenStatement) && isExit(s.elseStatement);
  return false;
};
type Env = Map<string, Taint>;

interface FnInfo {
  node: ts.FunctionLikeDeclaration;
  paramTaint: Map<number, Taint>;
  ret?: Taint;
}

const REQUEST_ROOTS = new Set(["req", "request"]);
// What a request carries. `req.user`, `req.userId`, `req.session` are set by the server's own auth and are trusted.
const REQUEST_FIELDS = new Set(["body", "query", "params", "headers", "cookies", "url", "originalUrl", "path", "hostname", "files", "file", "nextUrl", "formData", "json", "text", "get", "header", "param", "searchParams", "arrayBuffer", "blob"]);
const SANITIZER_NAMES = new Set(["Number", "parseInt", "parseFloat", "Boolean", "encodeURIComponent", "encodeURI", "escape", "escapeHtml", "escapeHTML", "basename", "safeParse", "safeParseAsync", "parseAsync", "toNumber", "isUUID", "isInt"]);
const PASSTHROUGH_NAMES = new Set(["String", "toString", "trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "replace", "replaceAll", "slice", "substring", "substr", "concat", "join", "resolve", "normalize", "decodeURIComponent", "decodeURI", "atob", "from", "stringify", "split", "padStart", "padEnd", "format", "at"]);
const SQL_NAMES = new Set(["query", "execute", "raw", "unsafe", "queryRaw", "executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]);
const COMMAND_NAMES = new Set(["exec", "execSync", "spawn", "spawnSync", "execFile", "execFileSync", "execa"]);
const COMMAND_RECEIVERS = new Set(["child_process", "cp", "childProcess", "shell"]);
const PATH_NAMES = new Set(["readFile", "readFileSync", "createReadStream", "sendFile", "unlink", "unlinkSync", "writeFile", "writeFileSync", "appendFile", "readdir", "readdirSync", "rm", "rmSync", "download", "access", "stat"]);
const PATH_RECEIVERS = new Set(["fs", "fsp", "promises", "fsPromises", "res", "response", "reply"]);
const FETCH_RECEIVER_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "request"]);
const HTML_SEND = new Set(["send", "write", "end", "html"]);
const RESPONSE_RECEIVERS = new Set(["res", "response", "reply"]);

const unwrap = (n: ts.Node): ts.Node => {
  let cur = n;
  while (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur) || ts.isAwaitExpression(cur) || ts.isTypeAssertionExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
  return cur;
};

/** For `req.params.id`, `request.json()` and similar: the identifier at the root and the property right after it. */
function rootAndField(n: ts.Node): { root: string; field: string } | null {
  let cur: ts.Node = n;
  let field: string | undefined;
  for (;;) {
    cur = unwrap(cur);
    if (ts.isCallExpression(cur)) cur = cur.expression;
    else if (ts.isPropertyAccessExpression(cur)) {
      field = cur.name.text;
      cur = cur.expression;
    } else if (ts.isElementAccessExpression(cur)) {
      if (ts.isStringLiteralLike(cur.argumentExpression)) field = cur.argumentExpression.text;
      cur = cur.expression;
    } else break;
  }
  return ts.isIdentifier(cur) && field ? { root: cur.text, field } : null;
}

const rootIdentifier = (n: ts.Node): string | null => {
  let cur = unwrap(n);
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = unwrap(cur.expression);
  return ts.isIdentifier(cur) ? cur.text : null;
};

function calleeParts(call: ts.CallExpression | ts.NewExpression): { name: string; receiver: string } {
  const e = call.expression;
  if (ts.isIdentifier(e)) return { name: e.text, receiver: "" };
  if (ts.isPropertyAccessExpression(e)) return { name: e.name.text, receiver: e.expression.getText().replace(/\s+/g, "") };
  return { name: "", receiver: "" };
}

function isSanitizer(name: string, receiver: string): boolean {
  if (SANITIZER_NAMES.has(name)) return true;
  if (/^(?:sanitize|escape|validate|assert)/i.test(name)) return true;
  return name === "parse" && receiver !== "JSON" && receiver !== "";
}

const isAssign = (k: ts.SyntaxKind) => k === ts.SyntaxKind.EqualsToken || k === ts.SyntaxKind.PlusEqualsToken;

export function analyzeTaint(file: string, source: string): TaintFinding[] {
  const path = file.split("\\").join("/");
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path) || /\.(?:test|spec)\.[a-z]+$|(^|\/)node_modules\//.test(path)) return [];
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  } catch {
    return [];
  }
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 70);

  // Functions defined in this file that other code in the file can call by name.
  const fns = new Map<string, FnInfo>();
  const byNode = new Map<ts.Node, FnInfo>();
  const register = (name: string, node: ts.FunctionLikeDeclaration) => {
    const info: FnInfo = { node, paramTaint: new Map() };
    fns.set(name, info);
    byNode.set(node, info);
  };
  const collect = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name) register(n.name.text, n);
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = unwrap(n.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) register(n.name.text, init);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  let findings: TaintFinding[] = [];
  let changed = false;
  const fnStack: FnInfo[] = [];

  const sourceTaint = (n: ts.Node): Taint | null => {
    const rf = rootAndField(n);
    if (rf && REQUEST_ROOTS.has(rf.root) && REQUEST_FIELDS.has(rf.field)) {
      const inner = unwrap(n);
      return { desc: short(inner.getText(sf)), line: lineOf(n), chain: [] };
    }
    return null;
  };
  const extend = (t: Taint, name: string): Taint => (t.chain[t.chain.length - 1] === name ? t : { ...t, chain: [...t.chain, name] });

  // Does the start of this text (a template or a + chain) fix the host of a URL? Literal text beyond a bare scheme, or a first
  // value the server controls, does; a first value that comes from the request does not.
  const prefixTrusted = (n: ts.Node, env: Env): boolean => {
    const parts: Array<{ lit?: string; expr?: ts.Node }> = [];
    const flatten = (x: ts.Node) => {
      const u = unwrap(x);
      if (ts.isTemplateExpression(u)) {
        parts.push({ lit: u.head.text });
        for (const s of u.templateSpans) {
          flatten(s.expression);
          parts.push({ lit: s.literal.text });
        }
      } else if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        flatten(u.left);
        flatten(u.right);
      } else if (ts.isStringLiteralLike(u)) parts.push({ lit: u.text });
      else parts.push({ expr: u });
    };
    flatten(n);
    for (const p of parts) {
      if (p.lit !== undefined) {
        if (p.lit === "" || SCHEME_ONLY.test(p.lit)) continue;
        return true;
      }
      const t = evalExpr(p.expr!, env);
      return t === null ? true : t.hostSafe === true;
    }
    return false;
  };

  // Names that the condition shows to be one of a fixed set of allowed values when it is true (or false).
  const argRoot = (x: ts.Node): string | null => {
    let cur = unwrap(x);
    for (;;) {
      if (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) cur = unwrap(cur.expression.expression);
      else if (ts.isPropertyAccessExpression(cur)) cur = unwrap(cur.expression);
      else break;
    }
    return ts.isIdentifier(cur) ? cur.text : null;
  };
  const guardsWhenTrue = (c: ts.Node, env: Env): string[] => {
    const u = unwrap(c);
    if (ts.isBinaryExpression(u)) {
      const k = u.operatorToken.kind;
      if (k === ts.SyntaxKind.AmpersandAmpersandToken) return [...guardsWhenTrue(u.left, env), ...guardsWhenTrue(u.right, env)];
      if (k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken) {
        const [l, r] = [unwrap(u.left), unwrap(u.right)];
        if (ts.isStringLiteralLike(r) && ts.isIdentifier(l)) return [l.text];
        if (ts.isStringLiteralLike(l) && ts.isIdentifier(r)) return [r.text];
      }
      return [];
    }
    if (ts.isPrefixUnaryExpression(u) && u.operator === ts.SyntaxKind.ExclamationToken) return guardsWhenFalse(u.operand, env);
    if (ts.isCallExpression(u) && ts.isPropertyAccessExpression(u.expression) && ["includes", "has"].includes(u.expression.name.text) && u.arguments.length === 1) {
      // Only a list the server controls counts; a list taken from the request proves nothing.
      if (evalExpr(u.expression.expression, env)) return [];
      const root = argRoot(u.arguments[0]!);
      return root ? [root] : [];
    }
    return [];
  };
  const guardsWhenFalse = (c: ts.Node, env: Env): string[] => {
    const u = unwrap(c);
    if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.BarBarToken) return [...guardsWhenFalse(u.left, env), ...guardsWhenFalse(u.right, env)];
    if (ts.isPrefixUnaryExpression(u) && u.operator === ts.SyntaxKind.ExclamationToken) return guardsWhenTrue(u.operand, env);
    return [];
  };

  const evalExpr = (node: ts.Node, env: Env): Taint | null => {
    const n = unwrap(node);
    if (ts.isIdentifier(n)) return env.get(n.text) ?? null;
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const s = sourceTaint(n);
      if (s) return s;
      if (ts.isPropertyAccessExpression(n) && n.name.text === "length") return null;
      return evalExpr(n.expression, env);
    }
    if (ts.isCallExpression(n)) {
      const s = sourceTaint(n);
      if (s) return s;
      const { name, receiver } = calleeParts(n);
      if (isSanitizer(name, receiver)) return null;
      if (ts.isIdentifier(n.expression)) {
        const info = fns.get(n.expression.text);
        if (info) return info.ret ?? null;
      }
      const recv = ts.isPropertyAccessExpression(n.expression) ? evalExpr(n.expression.expression, env) : null;
      if (recv) return recv;
      if (PASSTHROUGH_NAMES.has(name) || name === "parse") {
        for (const a of n.arguments) {
          const t = evalExpr(a, env);
          if (t) return t;
        }
      }
      return null;
    }
    if (ts.isTemplateExpression(n)) {
      for (const span of n.templateSpans) {
        const t = evalExpr(span.expression, env);
        if (t) return { ...t, hostSafe: prefixTrusted(n, env) };
      }
      return null;
    }
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      if (k === ts.SyntaxKind.PlusToken) {
        const t = evalExpr(n.left, env) ?? evalExpr(n.right, env);
        return t ? { ...t, hostSafe: prefixTrusted(n, env) } : null;
      }
      if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.AmpersandAmpersandToken) {
        return evalExpr(n.left, env) ?? evalExpr(n.right, env);
      }
      return null;
    }
    if (ts.isConditionalExpression(n)) return evalExpr(n.whenTrue, env) ?? evalExpr(n.whenFalse, env);
    if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        const t = ts.isPropertyAssignment(p) ? evalExpr(p.initializer, env) : ts.isShorthandPropertyAssignment(p) ? env.get(p.name.text) ?? null : ts.isSpreadAssignment(p) ? evalExpr(p.expression, env) : null;
        if (t) return t;
      }
      return null;
    }
    if (ts.isArrayLiteralExpression(n)) {
      for (const el of n.elements) {
        const t = evalExpr(el, env);
        if (t) return t;
      }
      return null;
    }
    if (ts.isSpreadElement(n)) return evalExpr(n.expression, env);
    return null;
  };

  const bind = (name: ts.BindingName, t: Taint | null, env: Env) => {
    if (ts.isIdentifier(name)) {
      if (t) env.set(name.text, extend(t, name.text));
      else env.delete(name.text);
      return;
    }
    for (const el of name.elements) if (!ts.isOmittedExpression(el)) bind(el.name, t, env);
  };

  const report = (kind: TaintKind, sinkNode: ts.Node, sinkDesc: string, t: Taint) => {
    const m = META[kind];
    const sinkLine = lineOf(sinkNode);
    if (findings.some((f) => f.kind === kind && f.sink.line === sinkLine && f.sink.description === sinkDesc)) return;
    const via = t.chain.length ? ` through ${t.chain.join(" → ")}` : "";
    findings.push({
      file: path, kind, cwe: m.cwe, severity: m.severity,
      source: { description: t.desc, line: t.line },
      sink: { description: sinkDesc, line: sinkLine },
      path: t.chain,
      message: `Untrusted input from ${t.desc} (line ${t.line})${via} reaches ${m.what} in ${sinkDesc} at line ${sinkLine}.`,
    });
  };

  const isPlainText = (n: ts.Node) => ts.isStringLiteralLike(unwrap(n)) || ts.isNoSubstitutionTemplateLiteral(unwrap(n));
  const firstTainted = (args: readonly ts.Node[], env: Env): { t: Taint; node: ts.Node } | null => {
    for (const a of args) {
      const t = evalExpr(a, env);
      if (t) return { t, node: a };
    }
    return null;
  };
  const hasMarkupText = (n: ts.Node): boolean => {
    const u = unwrap(n);
    if (ts.isStringLiteralLike(u)) return u.text.includes("<");
    if (ts.isTemplateExpression(u)) return u.head.text.includes("<") || u.templateSpans.some((s) => s.literal.text.includes("<"));
    if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) return hasMarkupText(u.left) || hasMarkupText(u.right);
    return false;
  };

  const checkCall = (call: ts.CallExpression, env: Env) => {
    const { name, receiver } = calleeParts(call);
    const args = call.arguments;
    if (ts.isIdentifier(call.expression)) {
      const info = fns.get(call.expression.text);
      if (info) {
        args.forEach((a, i) => {
          const t = evalExpr(a, env);
          if (t && !info.paramTaint.has(i)) {
            info.paramTaint.set(i, t);
            changed = true;
          }
        });
      }
    }
    const desc = `${receiver ? `${receiver}.` : ""}${name}()`;
    const bare = receiver === "";
    if (SQL_NAMES.has(name) && args.length > 0) {
      let arg: ts.Node = args[0]!;
      const u = unwrap(arg);
      if (ts.isObjectLiteralExpression(u)) {
        const text = u.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ["text", "sql"].includes(p.name.getText(sf)));
        if (text) arg = text.initializer;
      }
      if (!isPlainText(arg)) {
        const t = evalExpr(arg, env);
        if (t) report("sql-injection", call, desc, t);
      }
      return;
    }
    if (COMMAND_NAMES.has(name) && (bare || COMMAND_RECEIVERS.has(receiver)) && args.length > 0) {
      const t = evalExpr(args[0]!, env);
      if (t && !isPlainText(args[0]!)) report("command-injection", call, desc, t);
      return;
    }
    if (bare && name === "eval" && args.length > 0) {
      const t = evalExpr(args[0]!, env);
      if (t) report("code-injection", call, desc, t);
      return;
    }
    if (PATH_NAMES.has(name) && (bare || PATH_RECEIVERS.has(receiver)) && args.length > 0) {
      const t = evalExpr(args[0]!, env);
      if (t) report("path-traversal", call, desc, t);
      return;
    }
    if ((bare && (name === "fetch" || name === "got" || name === "axios")) || ((receiver === "axios" || receiver === "got" || receiver === "http" || receiver === "https") && FETCH_RECEIVER_METHODS.has(name))) {
      if (args.length > 0) {
        let arg: ts.Node = args[0]!;
        const u = unwrap(arg);
        if (ts.isObjectLiteralExpression(u)) {
          const url = u.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(sf) === "url");
          if (url) arg = url.initializer;
        }
        const t = evalExpr(arg, env);
        // Request data in the path or query of a URL on a host the server chose is not forgery of the host.
        if (t && t.hostSafe !== true) report("ssrf", call, desc, t);
      }
      return;
    }
    if (name === "redirect") {
      const hit = firstTainted(args, env);
      if (hit) report("open-redirect", call, desc, hit.t);
      return;
    }
    if (HTML_SEND.has(name) && RESPONSE_RECEIVERS.has(receiver) && args.length > 0 && hasMarkupText(args[0]!)) {
      const t = evalExpr(args[0]!, env);
      if (t) report("xss", call, desc, t);
    }
  };

  const merge = (target: Env, ...from: Env[]) => {
    target.clear();
    for (const e of from) for (const [k, v] of e) if (!target.has(k)) target.set(k, v);
  };

  const analyzeFunction = (node: ts.FunctionLikeDeclaration, parentEnv: Env) => {
    const env: Env = new Map(parentEnv);
    const info = byNode.get(node);
    node.parameters.forEach((p, i) => {
      const t = info?.paramTaint.get(i) ?? null;
      bind(p.name, t, env);
    });
    if (info) fnStack.push(info);
    try {
      if (node.body) {
        if (ts.isBlock(node.body)) ts.forEachChild(node.body, (c) => visit(c, env));
        else {
          visit(node.body, env);
          if (info && !info.ret) {
            const t = evalExpr(node.body, env);
            if (t) {
              info.ret = t;
              changed = true;
            }
          }
        }
      }
    } finally {
      if (info) fnStack.pop();
    }
  };

  const visit = (node: ts.Node, env: Env): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
      analyzeFunction(node, env);
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer) {
        visit(node.initializer, env);
        const init = unwrap(node.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return; // a function value is not data
        bind(node.name, evalExpr(node.initializer, env), env);
      }
      return;
    }
    if (ts.isReturnStatement(node)) {
      if (node.expression) {
        visit(node.expression, env);
        const info = fnStack[fnStack.length - 1];
        if (info && !info.ret) {
          const t = evalExpr(node.expression, env);
          if (t) {
            info.ret = t;
            changed = true;
          }
        }
      }
      return;
    }
    if (ts.isBinaryExpression(node) && isAssign(node.operatorToken.kind)) {
      visit(node.right, env);
      const t = evalExpr(node.right, env);
      const left = unwrap(node.left);
      if (ts.isIdentifier(left)) {
        if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          if (t) env.set(left.text, extend(t, left.text));
          else env.delete(left.text);
        } else if (t) env.set(left.text, extend(t, left.text));
      } else {
        if (t && ts.isPropertyAccessExpression(left) && (left.name.text === "innerHTML" || left.name.text === "outerHTML")) {
          report("xss", node, `${left.getText(sf)} =`, t);
        }
        const base = rootIdentifier(left);
        if (base && t) env.set(base, extend(t, base));
      }
      return;
    }
    if (ts.isIfStatement(node)) {
      visit(node.expression, env);
      // Inside a branch, a value the condition has checked against an allowed list is no longer untrusted.
      const a: Env = new Map(env);
      for (const g of guardsWhenTrue(node.expression, env)) a.delete(g);
      visit(node.thenStatement, a);
      const b: Env = new Map(env);
      for (const g of guardsWhenFalse(node.expression, env)) b.delete(g);
      if (node.elseStatement) visit(node.elseStatement, b);
      // A branch that always leaves (return, throw) does not continue into the code after the if.
      const thenLeaves = isExit(node.thenStatement);
      const elseLeaves = isExit(node.elseStatement);
      if (thenLeaves && !elseLeaves) merge(env, b);
      else if (elseLeaves && !thenLeaves) merge(env, a);
      else merge(env, a, b);
      return;
    }
    if (ts.isCallExpression(node)) {
      ts.forEachChild(node, (c) => visit(c, env));
      checkCall(node, env);
      return;
    }
    if (ts.isNewExpression(node)) {
      ts.forEachChild(node, (c) => visit(c, env));
      if (ts.isIdentifier(node.expression) && node.expression.text === "Function" && node.arguments) {
        const hit = firstTainted([...node.arguments], env);
        if (hit) report("code-injection", node, "new Function()", hit.t);
      }
      return;
    }
    ts.forEachChild(node, (c) => visit(c, env));
  };

  try {
    // Calls and returns can hand taint to functions defined earlier or later, so the file is walked until nothing new is learned.
    for (let pass = 0; pass < 6; pass++) {
      findings = [];
      changed = false;
      visit(sf, new Map());
      if (!changed) break;
    }
  } catch {
    return [];
  }
  return findings.sort((a, b) => a.sink.line - b.sink.line || a.kind.localeCompare(b.kind));
}
