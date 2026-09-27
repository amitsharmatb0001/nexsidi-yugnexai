import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// 2026-09-28: real finding (project a61968de2ecf, Cardwise). @yugnex/core's
// css()/keyframes() only reach the browser from CLIENT modules — the rules
// are collected by <StyleRegistry> while the client tree renders, and a
// React Server Component's module-level css() call runs in a separate module
// graph whose rules nothing ever flushes. Cardwise's app/page.tsx,
// app/not-found.tsx and components/layout/Footer.tsx were Server Components:
// their class names shipped with NO CSS rules, so the landing page rendered
// as bare HTML (no layout, spacing, sizes or colours). NexUI's own vendored
// components all start with "use client" for exactly this reason.
//
// Deterministic safety net, run before every compile check (see
// pipeline/activities/index.ts runCompileCheck): any app/components/lib
// module that imports @yugnex/core and calls css()/keyframes() gets
// "use client". A module Next.js can't turn into a client module — one that
// exports metadata/generateMetadata/generateStaticParams/revalidate/dynamic,
// or is an async server component — is left unchanged and reported, since
// adding the directive would break `next build` (the generator's prompt rule
// tells it to move styled UI into a client component instead).
const SCAN_ROOTS = ["app", "components", "lib"];
const VENDORED = `components${sep}nexui`;
const STYLE_CALL = /\b(?:css|keyframes)\s*\(/;
const CORE_IMPORT = /from\s+["']@yugnex\/core["']/;
const DIRECTIVE = /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use (?:client|server)["']/;
const SERVER_ONLY_EXPORT = /export\s+(?:const|let|async\s+function|function)\s+(?:metadata|generateMetadata|generateStaticParams|generateViewport|viewport|revalidate|dynamic|runtime)\b/;
const ASYNC_COMPONENT = /export\s+default\s+async\s+function\b/;

export interface ClientDirectiveResult {
  updated: string[];
  skipped: Array<{ path: string; reason: string }>;
}

function listSources(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listSources(full, out);
    else if (/\.(?:tsx|ts|jsx|js)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
}

export function ensureClientDirectiveForStyledModules(frontendDir: string): ClientDirectiveResult {
  const result: ClientDirectiveResult = { updated: [], skipped: [] };
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const dir = join(frontendDir, root);
    if (existsSync(dir)) listSources(dir, files);
  }
  for (const file of files) {
    const rel = relative(frontendDir, file);
    if (rel === VENDORED || rel.startsWith(VENDORED + sep)) continue;
    const source = readFileSync(file, "utf-8");
    if (!CORE_IMPORT.test(source) || !STYLE_CALL.test(source) || DIRECTIVE.test(source)) continue;
    const posix = rel.split(sep).join("/");
    if (SERVER_ONLY_EXPORT.test(source)) {
      result.skipped.push({ path: posix, reason: "exports server-only config (e.g. metadata) — move the styled UI into a client component" });
      continue;
    }
    if (ASYNC_COMPONENT.test(source)) {
      result.skipped.push({ path: posix, reason: "async server component — move the styled UI into a client component" });
      continue;
    }
    writeFileSync(file, `"use client";\n${source}`, "utf-8");
    result.updated.push(posix);
  }
  return result;
}
