import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunConfig } from "../../packages/agent-runtime/src/loop.ts";
import { extractNotApplied } from "./clone-report.ts";
import { applyCloneChanges, CLONE_EDIT_SYSTEM_PROMPT } from "./clone-changes.ts";
import { applyCloneBackendChanges, CLONE_BACKEND_EDIT_SYSTEM_PROMPT } from "./clone-backend-changes.ts";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

// 2026-10-17 (Shopbill run 12): the request said the PO reference is typed "when creating or editing an invoice".
// The app has no edit screen, so only creating could be done — and the summary never said so.
test("extractNotApplied reads the parts the pass reports it could not apply", () => {
  const summary = [
    "1. Headline updated in Hero.tsx.",
    "Not applied: editing an invoice — the app has no invoice edit screen, so the PO reference is only typed when creating.",
    "- Not applied - dark mode: the app has no theme switch.",
    "Applied everything else.",
  ].join("\n");
  expect(extractNotApplied(summary)).toEqual([
    "editing an invoice — the app has no invoice edit screen, so the PO reference is only typed when creating.",
    "dark mode: the app has no theme switch.",
  ]);
});

test("extractNotApplied returns nothing when the summary reports nothing left out, and ignores the phrase mid-sentence", () => {
  expect(extractNotApplied("All five changes applied.")).toEqual([]);
  expect(extractNotApplied("The change was not applied: because it was unnecessary? No — it was done.")).toEqual([]);
  expect(extractNotApplied("")).toEqual([]);
});

test("extractNotApplied is case-insensitive, trims, drops empty entries and duplicates", () => {
  expect(extractNotApplied("NOT APPLIED:   a thing  \nnot applied: \nNot applied: a thing")).toEqual(["a thing"]);
});

test("both editing prompts tell the pass to report what it could not apply instead of staying silent or inventing it", () => {
  for (const prompt of [CLONE_EDIT_SYSTEM_PROMPT, CLONE_BACKEND_EDIT_SYSTEM_PROMPT]) {
    expect(prompt).toContain("Not applied:");
    expect(prompt.toLowerCase()).toContain("does not exist");
  }
});

test("applyCloneChanges returns the parts the pass reported as not applied", async () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-report-"));
  mkdirSync(join(dir, "frontend", "app"), { recursive: true });
  writeFileSync(join(dir, "frontend", "app", "page.tsx"), "export default function P() { return null; }\n");
  const runGenerator = async (_c: AgentRunConfig) => ({
    success: true,
    summary: "1. Done in Form.tsx.\nNot applied: editing — the app has no edit screen.",
    filesWritten: [],
    iterations: 3,
    errors: [],
    escalated: false,
  });
  const r = await applyCloneChanges({ buildDir: dir, changes: "c", newName: "N", apiKey: "k" }, { runGenerator, anchors: async () => [], verify: async () => ({ ran: true, ok: true, output: "" }) });
  expect(r.notApplied).toEqual(["editing — the app has no edit screen."]);
});

test("applyCloneBackendChanges returns the parts the pass reported as not applied", async () => {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-report-"));
  mkdirSync(join(dir, "backend", "src"), { recursive: true });
  writeFileSync(join(dir, "backend", "package.json"), "{}");
  const runGenerator = async (_c: AgentRunConfig) => ({
    success: true,
    summary: "Added the column.\nNot applied: bulk import — no import endpoint exists.",
    filesWritten: [],
    iterations: 3,
    errors: [],
    escalated: false,
  });
  const r = await applyCloneBackendChanges({ buildDir: dir, instructions: "x", apiKey: "k" }, { runGenerator, verify: async () => ({ ran: true, ok: true, output: "" }) });
  expect(r.notApplied).toEqual(["bulk import — no import endpoint exists."]);
});

// 2026-10-18 (Leafkeeper run 4): the backend accepted due dates only as full timestamps (z.string().datetime()) while
// the frontend's date picker sends "2026-10-31", so adding a task with a due date showed "Invalid datetime". The build,
// the type check and the delivery check all passed.
test("the backend prompt says a date picked on a form arrives as YYYY-MM-DD and must be accepted in that form", () => {
  expect(CLONE_BACKEND_EDIT_SYSTEM_PROMPT).toContain("YYYY-MM-DD");
  expect(CLONE_BACKEND_EDIT_SYSTEM_PROMPT).toContain("datetime()");
});

test("the frontend prompt says to read the backend's validator for each field and send exactly the format it accepts", () => {
  expect(CLONE_EDIT_SYSTEM_PROMPT.toLowerCase()).toContain("validator");
  expect(CLONE_EDIT_SYSTEM_PROMPT).toContain("YYYY-MM-DD");
});
