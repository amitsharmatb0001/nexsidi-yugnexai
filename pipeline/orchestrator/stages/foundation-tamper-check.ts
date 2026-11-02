// A builder's code changing a tested setting while the app runs (2026-11-02, Brewline 7). The write guard kept the backend builder
// out of the tested CORS file, so it wrote "(config as any).corsOrigin = ..." in its own routes file: the tested files stayed as
// written and every check passed. By fact, from the syntax tree: a builder's file may use what a tested file exports, and may not
// assign to it, delete from it or hand it to Object.assign / Object.defineProperty. Test files are not the app.
import ts from "typescript";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { foundationFileList } from "../../../packages/foundation/src/index.ts";

const SKIP = new Set(["node_modules", ".next", "dist", "build", ".git"]);
const CODE = /\.[jt]sx?$/;
const TEST = /\.(test|spec)\.[jt]sx?$/;
const CHANGERS = new Set(["assign", "defineProperty", "defineProperties", "setPrototypeOf"]);

function codeFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (SKIP.has(n) || n.startsWith("dist")) continue;
      const full = join(d, n);
      if (statSync(full).isDirectory()) walk(full);
      else if (CODE.test(n) && !TEST.test(n)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** The expression under casts, brackets and "!": (x as any)!  is x. */
function bare(e: ts.Expression): ts.Expression {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isTypeAssertionExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
  return cur;
}

/** The name a chain such as a.b["c"] starts from, or null. */
function rootName(e: ts.Expression): string | null {
  let cur = bare(e);
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) cur = bare(cur.expression);
  return ts.isIdentifier(cur) ? cur.text : null;
}

const ASSIGNING = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken]);

function changesIn(sf: ts.SourceFile, tested: Set<string>): Array<{ line: number; name: string }> {
  const names = new Set<string>();
  // Local names of what the tested files export.
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
    if (!tested.has(st.moduleSpecifier.text)) continue;
    const c = st.importClause;
    if (c.name) names.add(c.name.text);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const b of c.namedBindings.elements) names.add(b.name.text);
    if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) names.add(c.namedBindings.name.text);
  }
  if (names.size === 0) return [];
  // A named copy of the object itself is the object (a spread or a property read is not).
  const addCopies = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
      const v = bare(n.initializer);
      if (ts.isIdentifier(v) && names.has(v.text)) names.add(n.name.text);
    }
    ts.forEachChild(n, addCopies);
  };
  addCopies(sf);
  const found: Array<{ line: number; name: string }> = [];
  const add = (n: ts.Node, name: string) => found.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, name });
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && ASSIGNING.has(n.operatorToken.kind)) {
      const left = bare(n.left);
      if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
        const root = rootName(left);
        if (root && names.has(root)) add(n, root);
      }
    } else if (ts.isDeleteExpression(n)) {
      const root = rootName(n.expression);
      if (root && names.has(root)) add(n, root);
    } else if (ts.isCallExpression(n) && n.arguments[0]) {
      const callee = bare(n.expression);
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Object" && CHANGERS.has(callee.name.text)) {
        const root = rootName(n.arguments[0]);
        if (root && names.has(root)) add(n, root);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** One finding per change, with the file and line. */
export function foundationTamperFindings(dir: string, prefix = ""): string[] {
  const foundation = new Set(foundationFileList(dir));
  if (foundation.size === 0 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const abs of codeFiles(dir)) {
    const rel = relative(dir, abs).replace(/\\/g, "/");
    if (foundation.has(rel)) continue;
    const text = readFileSync(abs, "utf-8");
    const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(abs) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    // What this file's imports point at, among the tested files.
    const tested = new Set<string>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const spec = st.moduleSpecifier.text;
      if (!spec.startsWith(".")) continue;
      const target = relative(dir, resolve(dirname(abs), spec)).replace(/\\/g, "/").replace(/\.[jt]sx?$/, "");
      if ([...foundation].some((f) => f.replace(/\.[jt]sx?$/, "") === target || f.replace(/\.[jt]sx?$/, "") === `${target}/index`)) tested.add(spec);
    }
    for (const c of changesIn(sf, tested)) {
      out.push(`${prefix}${rel}:${c.line}: this changes ${c.name}, which comes from a tested file. Tested settings are set from the environment and stay as they are: remove this. If the app really needs something they do not give, call report_blocked with what you checked.`);
    }
  }
  return out;
}
