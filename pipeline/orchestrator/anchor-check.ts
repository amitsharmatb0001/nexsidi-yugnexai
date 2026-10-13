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
