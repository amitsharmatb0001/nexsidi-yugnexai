import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { installLogTimestamps } from "./log-timestamps.ts";

// 2026-10-25 (brewline2): the worker log had no times, so the longest step (the deploy and live review, 106 of 190 minutes)
// could not be split into its parts afterwards. Every log line now starts with the time it was written.

test("every console line gets the time it was written; a multi-line message is stamped once", () => {
  const out: string[] = [];
  const fake = { log: (...a: unknown[]) => out.push(a.join(" ")), warn: (...a: unknown[]) => out.push(a.join(" ")), error: (...a: unknown[]) => out.push(a.join(" ")), info: (...a: unknown[]) => out.push(a.join(" ")) };
  const restore = installLogTimestamps(fake as unknown as Console, () => new Date("2026-10-25T02:09:07.500Z"));
  fake.log("[stage6] Route sweep: passed (40 page visits)");
  fake.error("[stage6] not checked:\nfirst\nsecond");
  fake.warn("[x]", 3, { a: 1 });
  expect(out[0]).toBe("02:09:07 [stage6] Route sweep: passed (40 page visits)");
  expect(out[1]).toBe("02:09:07 [stage6] not checked:\nfirst\nsecond");
  expect(out[2]).toBe("02:09:07 [x] 3 [object Object]");
  restore();
  fake.log("plain");
  expect(out[3]).toBe("plain");
});

test("the worker installs it before anything else logs", () => {
  const src = readFileSync(new URL("./worker.ts", import.meta.url), "utf-8");
  expect(src).toContain("installLogTimestamps(");
  expect(src.indexOf("installLogTimestamps(")).toBeLessThan(src.indexOf("acquired lock"));
});
