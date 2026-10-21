// The code map: the structured context object that travels with a handoff (patent claims 1 and 3).
//
// Handing over "a list of file names" tells the receiver nothing about the code. This object carries, for every source file,
// its content hash and size, its syntax structure (a digest of the abstract syntax tree and a count of its nodes), what it
// imports, exports and declares, plus the project's dependency graph (file to file edges, external packages, import cycles),
// the rules the code has to follow, and the error records found in the code itself (syntax errors, imports that point at
// nothing). It is a pure function of the files and the rules, so recording it and checking it later give the same hash
// unless something really changed. The whole object goes through the SHA-256 chain with the rest of the handoff.
import ts from "typescript";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

export type SymbolKind = "function" | "class" | "interface" | "type" | "enum" | "variable" | "table";

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
}

export interface CodeFileEntry {
  path: string;
  sha256: string;
  lines: number;
  language: string;
  /** SHA-256 of the sequence of syntax node kinds: unchanged by renames, comments and spacing. Only for parsed files. */
  astDigest?: string;
  nodeCount?: number;
  imports: string[];
  exports: string[];
  symbols: CodeSymbol[];
}

export interface ErrorRecord {
  kind: "syntax-error" | "unresolved-import" | "missing-file" | "skipped-large-file";
  file: string;
  line?: number;
  detail: string;
}

export interface CodeMap {
  version: 1;
  files: CodeFileEntry[];
  graph: {
    edges: Array<{ from: string; to: string }>;
    /** package name -> files that import it */
    external: Record<string, string[]>;
    cycles: string[][];
  };
  rules: string[];
  errorRecords: ErrorRecord[];
  metadata: { fileCount: number; totalLines: number; languages: Record<string, number> };
}

export interface CodeMapOptions {
  rules?: string[];
  /** Files larger than this are hashed but not parsed. Default 1 MB. */
  maxFileBytes?: number;
}

const PARSED = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs"]);
const TEXT = new Set([...PARSED, "json", "sql", "css", "md", "html", "yml", "yaml", "env", "txt", "svg"]);
const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

const extOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "other" : base.slice(dot + 1).toLowerCase();
};

const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function packageName(spec: string): string {
  if (spec.startsWith("node:")) return spec;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function parseSource(path: string, text: string, ext: string) {
  const kind = ext === "tsx" || ext === "jsx" ? ts.ScriptKind.TSX : ext === "ts" ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const imports: Array<{ spec: string; line: number }> = [];
  const exportsOut = new Set<string>();
  const symbols: CodeSymbol[] = [];
  const kinds: string[] = [];

  const hasMod = (n: ts.Node, k: ts.SyntaxKind) => ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === k);

  const addSymbol = (name: string | undefined, kind: SymbolKind, node: ts.Node) => {
    if (!name) return;
    symbols.push({ name, kind, line: lineOf(node.getStart(sf)) });
    if (hasMod(node, ts.SyntaxKind.ExportKeyword)) {
      exportsOut.add(name);
      if (hasMod(node, ts.SyntaxKind.DefaultKeyword)) exportsOut.add("default");
    }
  };

  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st)) {
      addSymbol(st.name?.text, "function", st);
      if (!st.name && hasMod(st, ts.SyntaxKind.ExportKeyword) && hasMod(st, ts.SyntaxKind.DefaultKeyword)) exportsOut.add("default");
    } else if (ts.isClassDeclaration(st)) {
      addSymbol(st.name?.text, "class", st);
      if (!st.name && hasMod(st, ts.SyntaxKind.ExportKeyword) && hasMod(st, ts.SyntaxKind.DefaultKeyword)) exportsOut.add("default");
    } else if (ts.isInterfaceDeclaration(st)) addSymbol(st.name.text, "interface", st);
    else if (ts.isTypeAliasDeclaration(st)) addSymbol(st.name.text, "type", st);
    else if (ts.isEnumDeclaration(st)) addSymbol(st.name.text, "enum", st);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) addSymbol(d.name.text, "variable", st);
    } else if (ts.isExportAssignment(st)) exportsOut.add("default");
    else if (ts.isExportDeclaration(st)) {
      if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) imports.push({ spec: st.moduleSpecifier.text, line: lineOf(st.getStart(sf)) });
      if (st.exportClause && ts.isNamedExports(st.exportClause)) for (const el of st.exportClause.elements) exportsOut.add(el.name.text);
      else if (!st.exportClause) exportsOut.add("*");
    }
  }

  const walk = (node: ts.Node) => {
    kinds.push(ts.SyntaxKind[node.kind] ?? String(node.kind));
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({ spec: node.moduleSpecifier.text, line: lineOf(node.getStart(sf)) });
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]!)) {
      const callee = node.expression;
      if ((ts.isIdentifier(callee) && callee.text === "require") || callee.kind === ts.SyntaxKind.ImportKeyword) {
        imports.push({ spec: (node.arguments[0] as ts.StringLiteralLike).text, line: lineOf(node.getStart(sf)) });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);

  const diagnostics = ((sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []).slice(0, 5);
  const syntaxErrors = diagnostics.map((d) => ({ line: lineOf(d.start ?? 0), detail: ts.flattenDiagnosticMessageText(d.messageText, " ") }));

  // First occurrence wins, in source order (the walk visits imports in order; re-exports were added first).
  const seen = new Set<string>();
  const uniqueImports = imports.filter((i) => (seen.has(i.spec) ? false : (seen.add(i.spec), true)));
  return { imports: uniqueImports, exports: [...exportsOut], symbols, astDigest: sha(kinds.join(",")), nodeCount: kinds.length, syntaxErrors };
}

function sqlSymbols(text: string): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?\w+"?\.)?"?(\w+)"?/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ name: m[1]!, kind: "table", line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** Builds the code map for the listed files (paths relative to `root`, POSIX-separated). */
export function buildCodeMap(root: string, filePaths: string[], opts: CodeMapOptions = {}): CodeMap {
  const maxBytes = opts.maxFileBytes ?? 1_000_000;
  const paths = [...new Set(filePaths.map((p) => p.split("\\").join("/")))].sort();
  const known = new Set(paths);
  const errorRecords: ErrorRecord[] = [];
  const entries: CodeFileEntry[] = [];
  const parsedImports = new Map<string, Array<{ spec: string; line: number }>>();

  for (const path of paths) {
    const full = join(root, path);
    if (!existsSync(full)) {
      errorRecords.push({ kind: "missing-file", file: path, detail: "listed in the manifest but not on disk" });
      known.delete(path);
      continue;
    }
    const ext = extOf(path);
    const size = statSync(full).size;
    const buf = readFileSync(full);
    const text = TEXT.has(ext) ? buf.toString("utf8") : "";
    const entry: CodeFileEntry = { path, sha256: sha(buf), lines: lineCount(text), language: ext, imports: [], exports: [], symbols: [] };
    if (PARSED.has(ext)) {
      if (size > maxBytes) {
        errorRecords.push({ kind: "skipped-large-file", file: path, detail: `${size} bytes is over the ${maxBytes} byte parse limit; hashed but not parsed` });
      } else {
        const r = parseSource(path, text, ext);
        entry.astDigest = r.astDigest;
        entry.nodeCount = r.nodeCount;
        entry.imports = r.imports.map((i) => i.spec);
        entry.exports = r.exports;
        entry.symbols = r.symbols;
        parsedImports.set(path, r.imports);
        for (const e of r.syntaxErrors) errorRecords.push({ kind: "syntax-error", file: path, line: e.line, detail: e.detail });
      }
    } else if (ext === "sql") {
      entry.symbols = sqlSymbols(text);
    }
    entries.push(entry);
  }

  // ── dependency graph ──
  const tsconfigDirs = paths.filter((p) => p.endsWith("tsconfig.json")).map((p) => posix.dirname(p));
  const resolveRelative = (fromFile: string, base: string): string | null => {
    const candidates: string[] = [base];
    const m = /\.(m?js|jsx|cjs)$/.exec(base);
    if (m) {
      const stem = base.slice(0, -m[0].length);
      candidates.push(`${stem}.ts`, `${stem}.tsx`);
    }
    for (const e of RESOLVE_EXT) candidates.push(base + e);
    for (const e of RESOLVE_EXT) candidates.push(`${base}/index${e}`);
    for (const c of candidates) if (known.has(c)) return c;
    return candidates.some((c) => existsSync(join(root, c))) ? "(outside manifest)" : null;
  };
  const resolveAlias = (fromFile: string, rest: string): string | null => {
    let dir = posix.dirname(fromFile);
    for (;;) {
      if (tsconfigDirs.includes(dir) || existsSync(join(root, dir, "tsconfig.json"))) {
        for (const base of [posix.join(dir, rest), posix.join(dir, "src", rest)]) {
          const r = resolveRelative(fromFile, base);
          if (r) return r;
        }
        return null;
      }
      if (dir === "." || dir === "/" || dir === "") return null;
      dir = posix.dirname(dir);
    }
  };

  const edgeSet = new Set<string>();
  const external: Record<string, Set<string>> = {};
  for (const [file, imps] of parsedImports) {
    for (const imp of imps) {
      let target: string | null;
      if (imp.spec.startsWith("./") || imp.spec.startsWith("../") || imp.spec === "." || imp.spec === "..") {
        target = resolveRelative(file, posix.normalize(posix.join(posix.dirname(file), imp.spec)));
        if (target === null) {
          errorRecords.push({ kind: "unresolved-import", file, line: imp.line, detail: `${imp.spec} does not match any file` });
          continue;
        }
      } else if (imp.spec.startsWith("@/") || imp.spec.startsWith("~/")) {
        target = resolveAlias(file, imp.spec.slice(2));
        if (target === null) continue; // an alias we cannot place is not reported as an error
      } else {
        (external[packageName(imp.spec)] ??= new Set()).add(file);
        continue;
      }
      if (target !== "(outside manifest)" && target !== file) edgeSet.add(`${file}\u0000${target}`);
      else if (target === file) edgeSet.add(`${file}\u0000${file}`);
    }
  }
  const edges = [...edgeSet].sort().map((e) => {
    const [from, to] = e.split("\u0000");
    return { from: from!, to: to! };
  });

  const out: CodeMap = {
    version: 1,
    files: entries,
    graph: {
      edges,
      external: Object.fromEntries(Object.keys(external).sort().map((k) => [k, [...external[k]!].sort()])),
      cycles: findCycles(edges),
    },
    rules: opts.rules ?? [],
    errorRecords: errorRecords.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.kind.localeCompare(b.kind)),
    metadata: { fileCount: entries.length, totalLines: entries.reduce((s, f) => s + f.lines, 0), languages: {} },
  };
  for (const f of entries) out.metadata.languages[f.language] = (out.metadata.languages[f.language] ?? 0) + 1;
  out.metadata.languages = Object.fromEntries(Object.entries(out.metadata.languages).sort(([a], [b]) => a.localeCompare(b)));
  return out;
}

/** Tarjan's strongly connected components; a component of two or more files (or a file that imports itself) is a cycle. */
function findCycles(edges: Array<{ from: string; to: string }>): string[][] {
  const next = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    (next.get(e.from) ?? next.set(e.from, []).get(e.from)!).push(e.to);
  }
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      for (let w = stack.pop()!; ; w = stack.pop()!) {
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      if (comp.length > 1 || (next.get(v) ?? []).includes(v)) cycles.push(comp.sort());
    }
  };
  for (const n of [...nodes].sort()) if (!index.has(n)) visit(n);
  return cycles.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

const closure = (start: string, edges: Array<{ from: string; to: string }>, forward: boolean): string[] => {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const [a, b] = forward ? [e.from, e.to] : [e.to, e.from];
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  }
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    for (const n of adj.get(queue.pop()!) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
  }
  seen.delete(start);
  return [...seen].sort();
};

/** Every file that, directly or through other files, imports `path`: what a change to it can reach. */
export const dependentsOf = (map: CodeMap, path: string): string[] => closure(path, map.graph.edges, false);

/** Every file that `path` needs, directly or through other files. */
export const dependenciesOf = (map: CodeMap, path: string): string[] => closure(path, map.graph.edges, true);

