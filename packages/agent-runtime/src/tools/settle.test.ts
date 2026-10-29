import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordVerdict, readVerdicts, SETTLE_DISPUTE_TOOL_DEF } from "./settle.ts";
import { buildToolList } from "../loop.ts";

// 2026-10-03 (evidence-only plan, T6): Tilotma — the only agent that sees the
// whole project — settles each dispute with her own checks and records a
// verdict with the evidence. A verdict without evidence is refused.
const prev = process.env.BUILD_DIR;
let dir = "";
afterEach(() => {
  process.env.BUILD_DIR = prev;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("a verdict with evidence is recorded; one without evidence or with an unknown verdict is refused", () => {
  dir = mkdtempSync(join(tmpdir(), "settle-"));
  process.env.BUILD_DIR = dir;
  expect(recordVerdict("p1", { number: 1, verdict: "not_true", evidence: "live page: --nx-color-primary: #059669" }).status).toBe("success");
  expect(recordVerdict("p1", { number: 2, verdict: "not_true", evidence: "" }).status).toBe("error");
  expect(recordVerdict("p1", { number: 2, verdict: "maybe", evidence: "x" }).status).toBe("error");
  const v = readVerdicts("p1");
  expect(v.length).toBe(1);
  expect(v[0]).toMatchObject({ number: 1, verdict: "not_true" });
});

test("the verdict tool is offered only to a dispute-settling run", () => {
  const base = { agentName: "tilotma", model: "x", apiKey: "", systemPrompt: "", initialMessage: "", sandboxDir: "." } as never;
  const names = (cfg: object) => buildToolList({ ...(base as object), ...cfg } as never).map((t) => t.function.name);
  expect(names({})).not.toContain("settle_dispute");
  expect(names({ enableDisputeSettling: true })).toContain("settle_dispute");
  expect(SETTLE_DISPUTE_TOOL_DEF.function.parameters.required).toEqual(["number", "verdict", "evidence"]);
});

// 2026-10-29 (team plan, stage 1): a true finding may need its fix in another builder's file than the one it names
// (Brewline 3: "the database has the column; the backend ignores it"). Tilotma names that file; it must be a project file.
test("a true verdict may name the project file that must change; anything outside backend/, frontend/ or db/ is refused", () => {
  dir = mkdtempSync(join(tmpdir(), "settle-fixin-"));
  process.env.BUILD_DIR = dir;
  expect(recordVerdict("p1", { number: 1, verdict: "true", evidence: "orders.ts joins menu_items", fix_in: "backend/src/routes/orders.ts" }).status).toBe("success");
  expect(recordVerdict("p1", { number: 2, verdict: "true", evidence: "x", fix_in: "../../etc/passwd" }).status).toBe("error");
  expect(readVerdicts("p1")[0]).toMatchObject({ number: 1, fixIn: "backend/src/routes/orders.ts" });
  expect(Object.keys(SETTLE_DISPUTE_TOOL_DEF.function.parameters.properties as Record<string, unknown>)).toContain("fix_in");
});
