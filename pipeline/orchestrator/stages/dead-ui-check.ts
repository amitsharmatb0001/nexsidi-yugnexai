// Dead-UI-element check — a cheap, mechanical, non-LLM pass that catches
// interactive elements with no way to actually do anything: no onClick, no
// href, not a real form-submit button.
//
// Root-caused live (fulfillio1): the "Invite Staff" button had NO onClick
// handler at all — a purely decorative <Button> — despite the locked spec
// explicitly requiring "As an Owner, I can invite new Staff members" and the
// landing page's own marketing copy promising it. Six adversarial QA rounds
// (Navya/Karan/Deepika) never caught it, and neither did Riya's live
// verification (verifyLiveAuthenticatedRoundTrip / verifyAllResourceCrud) —
// both read source as text or call the backend API directly via fetch();
// NEITHER ever renders a page or clicks anything, so a dead button that
// "looks" identical to a working one in source is invisible to both. Only
// found because a human opened a real browser and clicked it.
//
// This check closes that specific, structural gap — not a substitute for a
// real browser-driven pass (see the follow-up Tier-3 Playwright task), but a
// near-zero-cost first-pass filter that runs BEFORE any LLM QA round spends a
// single token, on exactly the class of bug that slipped through six rounds
// tonight.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { Finding } from "./stage4-multi-agent-dev.ts";

export interface RawJsxTag {
  raw: string;
  attrsText: string;
}

// Manual scanner, not a single regex: a JSX opening tag can contain nested
// braces whose own `{...}` expressions legally contain `>` (e.g.
// `onClick={() => foo(bar > 5)}`) or quoted strings containing `>` — a naive
// `/<Button[^>]*>/` regex would stop at the FIRST `>`, mis-truncating any tag
// with such an expression and either missing a real onClick or misreading
// attrs. Scans char-by-char from the tag's `<`, tracking brace depth and
// quote state, and only treats a bare `>` as the tag's end when depth is 0
// and not inside a string.
export function extractJsxTag(source: string, startIndex: number): RawJsxTag | null {
  let i = startIndex;
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }
    if (ch === "{") { depth++; i++; continue; }
    if (ch === "}") { depth--; i++; continue; }
    if (ch === ">" && depth === 0) {
      const raw = source.slice(startIndex, i + 1);
      return { raw, attrsText: raw };
    }
    i++;
  }
  return null; // unterminated tag (malformed source) — caller skips it
}

// Strips // line comments and /* */ block comments before scanning — a
// JSDoc comment describing the component ("...instead of a <button>.") is
// real prose text that happens to contain a literal "<button" substring, not
// actual JSX. Deliberately simple (doesn't understand string literals that
// contain "//", which is rare inside a JSX/TSX file's comment-adjacent code
// and not worth the complexity here) — this check already accepts some
// imprecision in exchange for near-zero cost; see this file's header.
// Blanks out comment text while preserving every newline at its original
// position (replaces each non-newline character with a space) — a
// multi-line block comment collapsed onto one line would shift every
// subsequent finding's reported line number.
function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/.*$/gm, blank);
}

// Pure. Scans one file's source for <Button ...> / <button ...> JSX opening
// tags with no onClick, no href, and no explicit type="submit" — the three
// ways this codebase's Button component (and a bare native <button>) can
// legitimately do something when clicked. `asChild` usage (Button wrapping a
// Link/other element via cloneElement) is excluded — its own child element
// carries the real interactivity, not this tag's own attrs.
export function findDeadButtons(filePath: string, rawSource: string): Finding[] {
  const findings: Finding[] = [];
  const source = stripComments(rawSource);
  const tagPattern = /<(Button|button)\b/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source)) !== null) {
    const tag = extractJsxTag(source, match.index);
    if (!tag) continue;
    const { attrsText } = tag;
    const hasOnClick = /\bonClick\s*=/.test(attrsText);
    const hasHref = /\bhref\s*=/.test(attrsText);
    const hasSubmitType = /\btype\s*=\s*["']submit["']/.test(attrsText);
    const isAsChild = /\basChild\b/.test(attrsText);
    if (hasOnClick || hasHref || hasSubmitType || isAsChild) continue;

    const lineNumber = source.slice(0, match.index).split("\n").length;
    const preview = attrsText.length > 80 ? attrsText.slice(0, 80) + "…" : attrsText;
    findings.push({
      file: filePath,
      issue: `Interactive element with no onClick/href/type="submit" at line ${lineNumber} — appears to be dead UI: ${preview.replace(/\s+/g, " ").trim()}`,
    });
  }
  return findings;
}

// Real filesystem walk — mirrors the pattern Stage 4/6 already use for
// scanning generated output (readdirSync + statSync, no external glob dep).
// Only frontend/**/*.tsx and *.jsx — backend has no JSX to scan, and this
// check's whole reason to exist is catching UI wiring gaps.
// 2026-08-17: components/nexui/ is vendored, pre-written library code (per
// Aanya's own prompt: "STATIC FILES ALREADY WRITTEN"), not per-project
// generated application code — its own <button {...props}> passes an
// onClick straight through from whatever the CALLER supplied, which this
// static text scan has no way to see. Scanning it produced two false
// positives (button.tsx's own two internal <button> uses) with zero real
// signal — the bugs this check exists to catch live in app/, where a
// missing handler is hardcoded and real.
const EXCLUDED_DIRS = new Set(["node_modules", ".next", "dist", "nexui"]);
function walkTsxFiles(dir: string, projectRoot: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const rel = full.slice(projectRoot.length + 1).replace(/\\/g, "/");
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walkTsxFiles(full, projectRoot));
    } else if (extname(entry) === ".tsx" || extname(entry) === ".jsx") {
      out.push(rel);
    }
  }
  return out;
}

export function scanProjectForDeadButtons(projectId: string): Finding[] {
  const buildDir = process.env.BUILD_DIR ?? "E:/tmp/nexsidi-builds";
  const projectRoot = join(buildDir, projectId);
  const frontendDir = join(projectRoot, "frontend");
  const files = walkTsxFiles(frontendDir, projectRoot);
  const findings: Finding[] = [];
  for (const relPath of files) {
    let source: string;
    try {
      source = readFileSync(join(projectRoot, relPath), "utf-8");
    } catch {
      continue;
    }
    findings.push(...findDeadButtons(relPath, source));
  }
  return findings;
}
