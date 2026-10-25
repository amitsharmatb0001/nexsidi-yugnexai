import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFreePort, portReservations } from "./index.ts";

// 2026-10-24 (multi-user audit): ports were picked from a snapshot of what is in use, with nothing held between picking
// and starting the containers. The worker runs up to 6 activities at once, so two builds deploying together could pick
// the same port, and the second would fail to start. A port a build has picked is now held for it (shared file in the
// builds folder, 45 minutes), checked and taken in one step with no wait between.

let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; });
const freeEverywhere = { dockerPorts: () => new Set<number>(), isPortFreeOnHost: async () => true, warn: () => {} };

test("two builds picking at the same moment get different ports", async () => {
  root = mkdtempSync(join(tmpdir(), "ports-"));
  const a = portReservations(root, "project-a");
  const b = portReservations(root, "project-b");
  const [pa, pb] = await Promise.all([
    findFreePort(3200, 3299, { ...freeEverywhere, reservation: a }),
    findFreePort(3200, 3299, { ...freeEverywhere, reservation: b }),
  ]);
  expect(new Set([pa, pb]).size).toBe(2);
  expect([pa, pb].sort()).toEqual([3200, 3201]);
});

test("a build keeps its own held port when it asks again, and an expired hold is free", async () => {
  root = mkdtempSync(join(tmpdir(), "ports-"));
  const t0 = 1_000_000;
  const a = portReservations(root, "project-a", () => t0);
  a.reserve(3200);
  expect(a.isReserved(3200)).toBe(false); // its own
  expect(portReservations(root, "project-b", () => t0 + 60_000).isReserved(3200)).toBe(true);
  expect(portReservations(root, "project-b", () => t0 + 46 * 60_000).isReserved(3200)).toBe(false); // 45 minutes later
  expect(JSON.parse(readFileSync(join(root, ".port-reservations.json"), "utf-8"))["3200"].projectId).toBe("project-a");
});

test("a damaged reservation file is treated as empty, never as a reason to fail a build", async () => {
  root = mkdtempSync(join(tmpdir(), "ports-"));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(root, ".port-reservations.json"), "{not json");
  const r = portReservations(root, "project-a");
  expect(r.isReserved(3200)).toBe(false);
  r.reserve(3200);
  expect(portReservations(root, "project-b").isReserved(3200)).toBe(true);
});

test("the first deploy picks its three ports through the reservation", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect((src.match(/reservation: portReservations\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
});
