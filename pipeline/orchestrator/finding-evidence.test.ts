import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dropCodeContradictedFindings } from "./finding-evidence.ts";

// 2026-09-28: real false CRITICAL (project a034f90ba50e, Plantly). The live
// review claimed dashboard/page.tsx "imports 'SelectField' from
// '@/components/nexui/select', but '@/components/nexui/select' exports
// 'Select'" — select.tsx exports BOTH. The finding went straight to the
// frontend fixer (CRITICAL skips debate, and the live stage has no debate),
// which rewrote a working dashboard. A claim that a module doesn't export a
// symbol is mechanically checkable, so it's checked against the real source.
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "finding-evidence-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function put(rel: string, content: string) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content, "utf-8");
}

const SELECT = "export interface SelectProps {}\nexport function Select() { return null; }\nexport function SelectField() { return null; }\n";

test("drops an 'imports X from M' claim when M really exports X", () => {
  put("frontend/components/nexui/select.tsx", SELECT);
  const f = { file: "frontend/app/dashboard/page.tsx", issue: "[logic/CRITICAL] frontend/app/dashboard/page.tsx imports 'SelectField' from '@/components/nexui/select' and attempts to render it, but '@/components/nexui/select' exports 'Select'" };
  const r = dropCodeContradictedFindings([f], dir);
  expect(r.kept).toEqual([]);
  expect(r.dropped).toEqual([{ finding: f, reason: "@/components/nexui/select exports SelectField" }]);
});

test("keeps the claim when the module really does not export the symbol", () => {
  put("frontend/components/nexui/select.tsx", SELECT);
  const f = { file: "frontend/app/dashboard/page.tsx", issue: "imports 'Dropdown' from '@/components/nexui/select', which does not export it" };
  expect(dropCodeContradictedFindings([f], dir).kept).toEqual([f]);
});

test("resolves relative imports and `export { X }` lists", () => {
  put("backend/src/utils/jwt.ts", "function sign() {}\nexport { sign };\n");
  const f = { file: "backend/src/routes/auth.ts", detail: 'imports "sign" from "../utils/jwt" but that module has no such export' };
  expect(dropCodeContradictedFindings([f], dir).kept).toEqual([]);
});

test("keeps findings that make no import claim, or whose module can't be found", () => {
  const a = { file: "frontend/app/page.tsx", issue: "[logic/HIGH] the form submits twice" };
  const b = { file: "frontend/app/page.tsx", issue: "imports 'X' from '@/missing/module' which does not export it" };
  expect(dropCodeContradictedFindings([a, b], dir).kept).toEqual([a, b]);
});

test("guardLiveRetest: a retest whose only findings the code disproves passes — unless the design evaluation failed", async () => {
  const { guardLiveRetest } = await import("./stages/stage6-deployment.ts");
  const prior = process.env.BUILD_DIR;
  process.env.BUILD_DIR = dir;
  try {
    put("p1/frontend/components/nexui/select.tsx", SELECT);
    const finding = { file: "frontend/app/dashboard/page.tsx", issue: "imports 'SelectField' from '@/components/nexui/select' but it exports 'Select'" };
    expect(guardLiveRetest("p1", { pass: false, findings: [finding] })).toEqual({ pass: true, findings: [] });
    const withFailedEval = guardLiveRetest("p1", { pass: false, findings: [finding], liveEval: { pass: false } as any });
    expect(withFailedEval.pass).toBe(false);
    expect(withFailedEval.findings).toEqual([]);
  } finally {
    if (prior === undefined) delete process.env.BUILD_DIR; else process.env.BUILD_DIR = prior;
  }
});
