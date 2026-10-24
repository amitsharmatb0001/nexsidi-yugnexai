import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSampleData, readSeededRecords, recordSeededRecords, clearSeededRecords, seededRecordCondition } from "./index.ts";

// 2026-10-24 (Brewline resume): the staff test account created sample menu items. A menu item has no owner, so the
// cleanup (every account on the test domain and everything that points at it) left them: 4 "sample-menu" rows stayed in
// the delivered database and the next review reported them as duplicate menu items. Every sample record the system
// creates is now written down, and the cleanup removes exactly those rows (and what points at them).

let dir = "";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

test("sample records the seeder creates are written down, across rounds", async () => {
  dir = mkdtempSync(join(tmpdir(), "sc-"));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [{ method: "POST", path: "/api/v1/menu", auth: true, requestType: "{ name: string }" }] }));
  writeFileSync(join(dir, "shared-types.ts"), "");
  let n = 0;
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { id: `00000000-0000-4000-8000-00000000000${++n}` } }), { status: 201 })) as unknown as typeof fetch;
  await seedSampleData(dir, "http://b", "tok", 2);
  await seedSampleData(dir, "http://b", "tok", 1);
  expect(readSeededRecords(dir).sort()).toEqual([1, 2, 3].map((i) => `00000000-0000-4000-8000-00000000000${i}`));
  clearSeededRecords(dir);
  expect(readSeededRecords(dir)).toEqual([]);
});

test("only plain ids go into the cleanup condition", () => {
  dir = mkdtempSync(join(tmpdir(), "sc-"));
  recordSeededRecords(dir, { menu: ["a1b2", "x'; DROP TABLE menu_items; --"], orders: ["42"] });
  expect(readSeededRecords(dir).sort()).toEqual(["42", "a1b2"]);
  expect(seededRecordCondition(["a1b2", "42"])).toBe(`id::text IN ('a1b2', '42')`);
  expect(seededRecordCondition([])).toBeNull();
});

test("the cleanup removes the recorded sample records", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const purge = src.slice(src.indexOf("export function purgeVerificationArtifacts"), src.indexOf("export interface SeedResult"));
  expect(purge).toContain("readSeededRecords(buildDir)");
  expect(purge).toContain("seededRecordCondition(");
  expect(purge).toContain("clearSeededRecords(buildDir)");
});
