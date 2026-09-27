import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureClientDirectiveForStyledModules } from "./client-directive.ts";

// 2026-09-28: real finding (project a61968de2ecf, Cardwise). @yugnex/core's
// css()/keyframes() only reach the browser from CLIENT modules (they are
// collected by <StyleRegistry> during the client tree's SSR). app/page.tsx,
// app/not-found.tsx and components/layout/Footer.tsx called css() as Server
// Components: their class names rendered with NO CSS rules at all, so the
// landing page showed as bare, unstyled HTML. NexUI's own vendored
// components all start with "use client" for exactly this reason.
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "client-directive-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function put(rel: string, content: string) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf-8");
}
const read = (rel: string) => readFileSync(join(dir, rel), "utf-8");
const STYLED = 'import { css } from "@yugnex/core";\nconst c = css({ padding: 8 });\nexport default function P() { return <div className={c} />; }\n';

test("a server component that calls css() gets \"use client\" added", () => {
  put("app/page.tsx", STYLED);
  put("components/layout/Footer.tsx", STYLED.replace("export default function P", "export function Footer"));
  const r = ensureClientDirectiveForStyledModules(dir);
  expect(r.updated.sort()).toEqual(["app/page.tsx", "components/layout/Footer.tsx"]);
  expect(read("app/page.tsx").startsWith('"use client";\n')).toBe(true);
});

test("files already marked, unstyled files, vendored NexUI and the root layout are left alone", () => {
  put("app/dashboard/page.tsx", '"use client";\n' + STYLED);
  put("app/about/page.tsx", "export default function A() { return <p>hi</p>; }\n");
  put("components/nexui/button.tsx", STYLED);
  put("app/layout.tsx", 'import { createTheme } from "@yugnex/core";\nexport const metadata = { title: "x" };\n');
  const r = ensureClientDirectiveForStyledModules(dir);
  expect(r.updated).toEqual([]);
  expect(read("components/nexui/button.tsx")).toBe(STYLED);
});

test("a styled file that exports metadata or is an async server component is reported, not changed", () => {
  put("app/pricing/page.tsx", 'export const metadata = { title: "P" };\n' + STYLED);
  put("app/blog/page.tsx", STYLED.replace("export default function P", "export default async function P"));
  const r = ensureClientDirectiveForStyledModules(dir);
  expect(r.updated).toEqual([]);
  expect(r.skipped.map((s) => s.path).sort()).toEqual(["app/blog/page.tsx", "app/pricing/page.tsx"]);
});
