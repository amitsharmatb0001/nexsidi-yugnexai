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
