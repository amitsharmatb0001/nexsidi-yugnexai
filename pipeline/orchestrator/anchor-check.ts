// Links to a section of the same page that no longer exists.
// 2026-10-13 (Shopbill run 5): the comparison section was removed and the hero kept a "Compare vs Spreadsheets"
// button pointing at #comparison — a link to nowhere. Types and the build cannot see it.

export interface SourceFile {
  path: string;
  content: string;
}

export interface DanglingAnchor {
  anchor: string;
  file: string;
}

const HREF_RE = /href\s*=\s*\{?\s*["'`]#([A-Za-z][\w-]*)["'`]/g;
// id="x" · id={"x"} · id: "x"
const ID_RE = /\bid\s*(?:=|:)\s*\{?\s*["'`]([A-Za-z][\w-]*)["'`]/g;

/** In-page links (href="#x") whose target id exists nowhere in the given source files. */
export function findDanglingAnchors(files: SourceFile[]): DanglingAnchor[] {
  const ids = new Set<string>(["top"]); // "#top" scrolls to the top of any page
  for (const f of files) for (const m of f.content.matchAll(ID_RE)) ids.add(m[1]!);
  const found: DanglingAnchor[] = [];
  for (const f of files) {
    for (const m of f.content.matchAll(HREF_RE)) {
      const anchor = m[1]!;
      if (!ids.has(anchor) && !found.some((x) => x.anchor === anchor && x.file === f.path)) found.push({ anchor, file: f.path });
    }
  }
  return found;
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function resolveImport(from: string, spec: string, known: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith(".")) {
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    base = parts.join("/");
  } else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (known.has(c)) return c;
  }
  return null;
}

/**
 * Like findDanglingAnchors, but only files the app renders count: everything under app/ plus whatever they import,
 * directly or through other files. A leftover, unused component can no longer make a dead link look valid.
 */
export function reachableFiles(files: SourceFile[]): Set<string> {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const known = new Set(byPath.keys());
  const reachable = new Set<string>();
  const queue = files.filter((f) => f.path.startsWith("app/")).map((f) => f.path);
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (reachable.has(path)) continue;
    reachable.add(path);
    for (const m of byPath.get(path)!.content.matchAll(IMPORT_RE)) {
      const target = resolveImport(path, m[1]!, known);
      if (target && !reachable.has(target)) queue.push(target);
    }
  }
  return reachable;
}

export function findDanglingAnchorsInApp(files: SourceFile[]): DanglingAnchor[] {
  const reachable = reachableFiles(files);
  return findDanglingAnchors(files.filter((f) => reachable.has(f.path)));
}
