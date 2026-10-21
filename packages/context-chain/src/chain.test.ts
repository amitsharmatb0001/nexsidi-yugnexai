import { test, expect } from "bun:test";
import { hashContext } from "./hash.ts";
import { linkRecord, verifyChain, type ChainRow } from "./chain.ts";

// Patent claim 10: a hash chain wherein each context object contains SHA-256 hashes of all predecessor context objects,
// enabling complete audit trail reconstruction.
const h = (s: string) => hashContext({ s });

function build(contexts: string[]): ChainRow[] {
  const rows: ChainRow[] = [];
  for (const [i, c] of contexts.entries()) {
    const link = linkRecord(rows.map((r) => r.contextHash), h(c));
    rows.push({ chainSeq: i + 1, contextHash: h(c), predecessorHashes: link.predecessorHashes, chainHash: link.chainHash });
  }
  return rows;
}

test("the first record has no predecessors; each later record carries the hashes of every earlier one, in order", () => {
  const rows = build(["spec", "plan", "backend"]);
  expect(rows[0]!.predecessorHashes).toEqual([]);
  expect(rows[1]!.predecessorHashes).toEqual([h("spec")]);
  expect(rows[2]!.predecessorHashes).toEqual([h("spec"), h("plan")]);
});

test("chainHash is a 64-character SHA-256 over the predecessors and the record's own hash, and differs when either changes", () => {
  const a = linkRecord([h("x")], h("y"));
  expect(a.chainHash).toMatch(/^[0-9a-f]{64}$/);
  expect(linkRecord([h("x")], h("z")).chainHash).not.toBe(a.chainHash);
  expect(linkRecord([h("q")], h("y")).chainHash).not.toBe(a.chainHash);
});

test("an untouched chain verifies", () => {
  expect(verifyChain(build(["spec", "plan", "backend", "frontend"]))).toEqual({ valid: true, checked: 4 });
});

test("a record whose own hash was altered is detected where it happened", () => {
  const rows = build(["spec", "plan", "backend"]);
  rows[1] = { ...rows[1]!, contextHash: h("tampered") };
  const r = verifyChain(rows);
  expect(r.valid).toBe(false);
  expect(r.brokenAt).toBe(1);
});

test("a record removed from the middle is detected (the later records still name it)", () => {
  const rows = build(["spec", "plan", "backend"]);
  rows.splice(1, 1);
  const r = verifyChain(rows);
  expect(r.valid).toBe(false);
  expect(r.reason).toBe("predecessors_mismatch");
});

test("records swapped in order are detected", () => {
  const rows = build(["spec", "plan", "backend"]);
  [rows[1], rows[2]] = [rows[2]!, rows[1]!];
  expect(verifyChain(rows).valid).toBe(false);
});

test("a forged chain hash is detected even when the predecessor list looks right", () => {
  const rows = build(["spec", "plan"]);
  rows[1] = { ...rows[1]!, chainHash: "0".repeat(64) };
  const r = verifyChain(rows);
  expect(r.valid).toBe(false);
  expect(r.reason).toBe("chain_hash_mismatch");
});

test("an empty chain is valid and checks nothing", () => {
  expect(verifyChain([])).toEqual({ valid: true, checked: 0 });
});
