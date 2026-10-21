// Estimating how running time grows with the amount of data (patent claim 9: Big-O estimation), from the code.
//
// Each function is walked once. A loop over data adds one level of nesting; so does an array method that takes a function
// (map, filter, some, reduce, find ...), with that function's body counted inside it. A sort is n log n at its level, and a
// linear search (`includes`, `indexOf`) inside a loop adds a level, because it scans the array on every pass. Loops with a
// small fixed bound (`i < 10`) and loops over a literal list do not grow with the data. The estimate is the deepest nesting
// found. Separately, a database or network call made inside a loop is listed: it costs one round trip per item (the "N+1"
// pattern) whatever the arithmetic says. Self-recursion is noted, and two self-calls with no cache is flagged as possibly
// exponential.
//
// What it cannot know: how large n really is, whether a collection is small, or what a called function costs. It reports a
// reading of the structure, not a measurement.
import ts from "typescript";

export interface FunctionComplexity {
  name: string;
  file: string;
  line: number;
  estimate: string;
  /** The degree of the estimate, for comparing runs: 0 constant, 1 linear, 2 quadratic ... (exponential is 99). */
  degree: number;
  reasons: string[];
  callsInLoop: Array<{ call: string; line: number }>;
  recursive: boolean;
  /** A React component (a capitalised function in a .tsx file) shows a list on screen, where n is usually small. */
  kind: "function" | "component";
}

const ITERATION_METHODS = new Set(["map", "forEach", "filter", "reduce", "reduceRight", "some", "every", "find", "findIndex", "findLast", "findLastIndex", "flatMap"]);
const SORT_METHODS = new Set(["sort", "toSorted"]);
const SEARCH_METHODS = new Set(["includes", "indexOf", "lastIndexOf"]);
const DATA_CALLS = new Set(["query", "execute", "findMany", "findOne", "findFirst", "findUnique", "findAll", "findById", "findOneBy", "save", "insert", "update", "delete", "destroy", "create", "upsert", "aggregate", "count"]);
const DATA_RECEIVER = /db|pool|client|prisma|knex|sql|repo|model|collection|orm|supabase|drizzle|redis|mongo|database/i;
const NETWORK_RECEIVERS = new Set(["axios", "got", "http", "https"]);
const HTTP_VERBS = new Set(["get", "post", "put", "patch", "delete", "all"]);

function estimateOf(degree: number, log: boolean): string {
  if (degree >= 99) return "O(2^n)";
  if (degree === 0) return "O(1)";
  const power = degree === 1 ? "n" : degree === 2 ? "n²" : degree === 3 ? "n³" : `n^${degree}`;
  return log ? `O(${power} log n)` : `O(${power})`;
}

const unwrap = (n: ts.Node): ts.Node => {
  let cur = n;
  while (ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur) || ts.isAsExpression(cur) || ts.isAwaitExpression(cur)) cur = cur.expression;
  return cur;
};

const isFunctionLike = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

export function analyzeComplexity(file: string, source: string, opts: { onlyConcerns?: boolean } = {}): FunctionComplexity[] {
  const path = file.split("\\").join("/");
  if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path) || /\.(?:test|spec)\.[a-z]+$|(^|\/)node_modules\//.test(path)) return [];
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  } catch {
    return [];
  }
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // Functions that get their own report, with the name to report them under.
  const reported = new Map<ts.Node, string>();
  const collect = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name) reported.set(n, n.name.text);
    else if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) reported.set(n, n.name.text);
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = unwrap(n.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) reported.set(init, n.name.text);
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && HTTP_VERBS.has(n.expression.name.text)) {
      const [first, ...rest] = n.arguments;
      if (first && ts.isStringLiteralLike(first)) {
        for (const a of rest) {
          const u = unwrap(a);
          if (ts.isArrowFunction(u) || ts.isFunctionExpression(u)) reported.set(u, `${n.expression.name.text.toUpperCase()} ${first.text}`);
        }
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const results: FunctionComplexity[] = [];
  for (const [node, name] of reported) {
    if (!isFunctionLike(node) || !node.body) continue;
    let best = { degree: 0, log: false };
    const reasons: string[] = [];
    const callsInLoop: FunctionComplexity["callsInLoop"] = [];
    let selfCalls = 0;
    const consider = (degree: number, log: boolean) => {
      if (degree > best.degree || (degree === best.degree && log && !best.log)) best = { degree, log };
    };

    // Lists written out in this function (const xs = [ ... ]) are as long as they are written; looping over one does not grow with the data.
    const fixedLists = new Set<string>();
    const findLists = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isArrayLiteralExpression(unwrap(n.initializer)) && (unwrap(n.initializer) as ts.ArrayLiteralExpression).elements.length <= 100) fixedLists.add(n.name.text);
      ts.forEachChild(n, findLists);
    };
    findLists(node.body);
    const isFixed = (x: ts.Node): boolean => {
      const u = unwrap(x);
      return ts.isArrayLiteralExpression(u) || (ts.isIdentifier(u) && fixedLists.has(u.text));
    };

    const walk = (n: ts.Node, depth: number): void => {
      if (n !== node.body && reported.has(n) && n !== node) return; // reported on its own
      if (ts.isForStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) {
        let bounded = false;
        if (ts.isForStatement(n) && n.condition && ts.isBinaryExpression(n.condition)) {
          const r = unwrap(n.condition.right);
          bounded = ts.isNumericLiteral(r) && Number(r.text) <= 100 && [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken].includes(n.condition.operatorToken.kind);
        }
        if (ts.isForOfStatement(n) && isFixed(n.expression)) bounded = true;
        const next = bounded ? depth : depth + 1;
        if (!bounded) {
          consider(next, false);
          if (next >= 2) reasons.push(`loops nested ${next} deep at line ${lineOf(n)}`);
        }
        ts.forEachChild(n, (c) => walk(c, next));
        return;
      }
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        const receiverNode = ts.isPropertyAccessExpression(callee) ? unwrap(callee.expression) : null;
        const receiver = receiverNode ? receiverNode.getText(sf).replace(/\s+/g, "") : "";
        const literalReceiver = receiverNode !== null && (ts.isArrayLiteralExpression(receiverNode) || ts.isStringLiteralLike(receiverNode) || ts.isTemplateExpression(receiverNode));
        const cbArg = n.arguments.find((a) => isFunctionLike(unwrap(a)));
        let childDepth = depth;
        if (method && ITERATION_METHODS.has(method) && cbArg && !(receiverNode !== null && isFixed(receiverNode))) {
          childDepth = depth + 1;
          consider(childDepth, false);
          if (childDepth >= 2) reasons.push(`${method} inside a loop or another ${method === "map" ? "map" : "array method"} at line ${lineOf(n)}`);
        } else if (method && SORT_METHODS.has(method)) {
          consider(depth + 1, true);
          reasons.push(`sort at line ${lineOf(n)}`);
        } else if (method && SEARCH_METHODS.has(method) && depth >= 1 && !literalReceiver) {
          consider(depth + 1, false);
          reasons.push(`linear search (${method}) inside a loop at line ${lineOf(n)}: scans the whole array on every pass if the receiver is an array`);
        }
        if (depth >= 1) {
          const isData = method !== "" && DATA_CALLS.has(method) && DATA_RECEIVER.test(receiver);
          const isNet = (ts.isIdentifier(callee) && (callee.text === "fetch" || callee.text === "got" || callee.text === "axios")) || (method !== "" && NETWORK_RECEIVERS.has(receiver) && (HTTP_VERBS.has(method) || method === "request"));
          if (isData || isNet) callsInLoop.push({ call: ts.isIdentifier(callee) ? callee.text : `${receiver}.${method}`, line: lineOf(n) });
        }
        if (ts.isIdentifier(callee) && callee.text === name && name !== "") selfCalls++;
        // The call's own arguments: callbacks to iteration methods run one level deeper, other arguments at this level.
        ts.forEachChild(n, (c) => walk(c, c === cbArg || (cbArg !== undefined && unwrap(c) === unwrap(cbArg)) ? childDepth : depth));
        return;
      }
      ts.forEachChild(n, (c) => walk(c, depth));
    };

    walk(node.body, 0);

    const recursive = selfCalls > 0;
    let degree = best.degree;
    let log = best.log;
    const bodyText = node.body.getText(sf);
    if (recursive) {
      if (selfCalls >= 2 && !/memo|cache|\bMap\b|dp\[/i.test(bodyText)) {
        degree = 99;
        reasons.push(`calls itself ${selfCalls} times with no cache (line ${lineOf(node)}): may grow exponentially`);
      } else {
        degree = Math.max(degree, 1);
        reasons.push(`recursive (line ${lineOf(node)}): cost depends on how deep the input goes`);
      }
    }
    if (callsInLoop.length > 0) reasons.push(`${callsInLoop.length} database or network call(s) inside a loop: one round trip per item`);
    results.push({
      name, file: path, line: lineOf(node), estimate: estimateOf(degree, log && degree < 99), degree,
      reasons: [...new Set(reasons)].slice(0, 6), callsInLoop, recursive,
      kind: /\.[jt]sx$/.test(path) && /^[A-Z]/.test(name) ? "component" : "function",
    });
  }
  const out = results.sort((a, b) => a.line - b.line);
  return opts.onlyConcerns ? out.filter((f) => f.degree >= 2 || f.callsInLoop.length > 0) : out;
}
