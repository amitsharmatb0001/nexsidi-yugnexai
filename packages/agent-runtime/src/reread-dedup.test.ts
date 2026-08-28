import { test, expect } from "bun:test";
import { createHash } from "node:crypto";

// 2026-08-27: real waste measured live (project 852be5aeaef4). The QA loop has
// had a FileReadCache since the cost-control work; the GENERATOR loop had no
// equivalent. Riya read docker-compose.yml 18 times and each Dockerfile 14
// times in ONE project. The expensive part is not disk I/O — it is that every
// re-read appends the file's entire content to the conversation, which is then
// re-sent on every subsequent call for the rest of the run.
//
// These tests pin the decision logic the gemini-loop read_file handler
// implements, so the dedup rules cannot silently regress.

const MIN = 400;

function shouldPointer(
  args: { path: string; offset?: number; limit?: number },
  status: "success" | "error",
  body: string,
  seen: Map<string, { hash: string; iteration: number }>,
): boolean {
  if (args.offset !== undefined || args.limit !== undefined) return false;
  if (status !== "success") return false;
  if (body.length <= MIN) return false;
  const hash = createHash("sha256").update(body).digest("hex");
  return seen.get(args.path)?.hash === hash;
}

const big = "y".repeat(2_000);

test("a second read of unchanged content is replaced by a pointer", () => {
  const seen = new Map([["docker-compose.yml", { hash: createHash("sha256").update(big).digest("hex"), iteration: 3 }]]);
  expect(shouldPointer({ path: "docker-compose.yml" }, "success", big, seen)).toBe(true);
});

test("the FIRST read always returns real content", () => {
  expect(shouldPointer({ path: "a.ts" }, "success", big, new Map())).toBe(false);
});

test("CHANGED content is returned in full — the agent edited it, so it is new information", () => {
  const seen = new Map([["a.ts", { hash: createHash("sha256").update(big).digest("hex"), iteration: 1 }]]);
  expect(shouldPointer({ path: "a.ts" }, "success", big + " edited", seen)).toBe(false);
});

test("a paginated re-read is never deduped — it is a different view of the file", () => {
  const seen = new Map([["a.ts", { hash: createHash("sha256").update(big).digest("hex"), iteration: 1 }]]);
  expect(shouldPointer({ path: "a.ts", offset: 100, limit: 50 }, "success", big, seen)).toBe(false);
});

test("a failed read is never remembered or deduped", () => {
  const seen = new Map([["a.ts", { hash: createHash("sha256").update(big).digest("hex"), iteration: 1 }]]);
  expect(shouldPointer({ path: "a.ts" }, "error", big, seen)).toBe(false);
});

test("small files are left alone — the pointer would not be smaller", () => {
  const small = "x".repeat(50);
  const seen = new Map([["tiny.json", { hash: createHash("sha256").update(small).digest("hex"), iteration: 1 }]]);
  expect(shouldPointer({ path: "tiny.json" }, "success", small, seen)).toBe(false);
});

test("the real handler implements these rules", () => {
  const src = require("node:fs").readFileSync(new URL("./gemini-loop.ts", import.meta.url), "utf-8");
  expect(src).toContain("seenFileReads");
  expect(src).toContain("REREAD_POINTER_MIN_CHARS");
  expect(src).toContain("unchanged since you read it on iteration");
  // Must not dedup paginated or failed reads.
  expect(src).toMatch(/offset === undefined && readArgs\.limit === undefined && result\?\.status === "success"/);
});
