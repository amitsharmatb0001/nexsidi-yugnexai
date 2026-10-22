import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordClaimEvidence, readClaimEvidence, summarizeClaims, CLAIM_TITLES } from "./claims-evidence.ts";

// 2026-10-22 (Trailhead Gear Rentals): several claim steps print nothing when they work, so after a real build it could not
// be shown whether they ran. Each step now writes one line to the build's own evidence file, and a report reads them back.

test("evidence lines are written to the build and read back in order", () => {
  const dir = mkdtempSync(join(tmpdir(), "claims-"));
  try {
    recordClaimEvidence(dir, 8, "security leads sent to the security reviewer", { leads: 4 });
    recordClaimEvidence(dir, 3, "handoff recorded", { seq: 1, from: "saanvi", to: "arjun" });
    const file = join(dir, ".nexsidi", "claims-evidence.jsonl");
    expect(existsSync(file)).toBe(true);
    const rows = readClaimEvidence(dir);
    expect(rows.map((r) => r.claim)).toEqual([8, 3]);
    expect(rows[0]!.detail).toEqual({ leads: 4 });
    expect(typeof rows[0]!.at).toBe("string");
    expect(readFileSync(file, "utf-8").trim().split("\n")).toHaveLength(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recording never creates a build folder that does not exist yet", () => {
  const dir = join(tmpdir(), `claims-missing-${Date.now()}`);
  recordClaimEvidence(dir, 1, "x", {});
  expect(existsSync(dir)).toBe(false);
});

test("recording never throws, even when the folder cannot be written", () => {
  expect(() => recordClaimEvidence("Z:/no/such/drive/\0bad", 1, "x", {})).not.toThrow();
  expect(readClaimEvidence("Z:/no/such/drive")).toEqual([]);
});

test("the summary lists all ten claims, marking the ones with no evidence", () => {
  const summary = summarizeClaims([
    { at: "t1", claim: 6, step: "review loop finished", detail: { iterations: 4 } },
    { at: "t2", claim: 6, step: "review loop finished", detail: { iterations: 2 } },
  ]);
  expect(summary.map((s) => s.claim)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const six = summary.find((s) => s.claim === 6)!;
  expect(six.ran).toBe(true);
  expect(six.count).toBe(2);
  expect(six.title).toBe(CLAIM_TITLES[6]);
  expect(summary.find((s) => s.claim === 7)!.ran).toBe(false);
});
