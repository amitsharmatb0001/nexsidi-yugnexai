import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-24 (docs/root-cause/2026-10-24-brewline.md): both builders had to finish phase N before either started N+1;
// the backend builder sat idle 54 of its 86 minutes. Now each builder runs its own phases straight through. Two waits
// stay because something really depends on them: the backend's phase 2 waits for the database step (as before), and the
// frontend's LAST phase — the only one with the whole-app browser check — waits for the finished backend.

// No timing: the backend's phases finish only when the test releases them, so the order is checked exactly.
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

test("each builder runs its phases without waiting for the other; only the frontend's last phase waits for the backend", async () => {
  const { runBuildPhases } = await import("./project-build.ts") as unknown as {
    runBuildPhases: (n: number, run: { aanya: (p: number) => Promise<void>; shubham?: (p: number) => Promise<void>; pranav?: () => Promise<void> }) => Promise<void>;
  };
  const log: string[] = [];
  const release: Array<() => void> = [];
  let releaseDb: () => void = () => {};
  const done = runBuildPhases(4, {
    aanya: async (p) => { log.push(`aanya ${p}`); },
    shubham: (p) => new Promise<void>((resolve) => { log.push(`shubham ${p} start`); release[p] = () => { log.push(`shubham ${p} end`); resolve(); }; }),
    pranav: () => new Promise<void>((resolve) => { releaseDb = () => { log.push("pranav end"); resolve(); }; }),
  });
  await settle();
  // The backend is still on phase 1, yet the frontend has done phases 1-3: no lockstep.
  expect(log).toEqual(["shubham 1 start", "aanya 1", "aanya 2", "aanya 3"]);
  release[1]!();
  await settle();
  // The backend's phase 2 waits for the database step.
  expect(log.includes("shubham 2 start")).toBe(false);
  releaseDb();
  await settle();
  expect(log.includes("shubham 2 start")).toBe(true);
  release[2]!();
  await settle();
  release[3]!();
  await settle();
  // The frontend's last phase still waits for the whole backend.
  expect(log.includes("aanya 4")).toBe(false);
  release[4]!();
  await done;
  expect(log.indexOf("aanya 4")).toBeGreaterThan(log.indexOf("shubham 4 end"));
});

test("a frontend-only build runs its phases in order", async () => {
  const { runBuildPhases } = await import("./project-build.ts") as unknown as {
    runBuildPhases: (n: number, run: { aanya: (p: number) => Promise<void> }) => Promise<void>;
  };
  const log: number[] = [];
  await runBuildPhases(3, { aanya: async (p) => { log.push(p); } });
  expect(log).toEqual([1, 2, 3]);
});

test("the workflow uses it behind a version marker, so builds already running keep the old order", () => {
  const src = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");
  expect(src).toContain('patched("independent-build-phases-v1")');
  expect(src).toContain("await runBuildPhases(phaseCount,");
});

test("a single team pass: the backend starts after the database step", async () => {
  const { runBuildPhases } = await import("./project-build.ts") as unknown as {
    runBuildPhases: (n: number, run: { aanya: (p: number) => Promise<void>; shubham?: (p: number) => Promise<void>; pranav?: () => Promise<void> }) => Promise<void>;
  };
  const log: string[] = [];
  let releaseDb: () => void = () => {};
  const done = runBuildPhases(1, {
    aanya: async () => { log.push("aanya"); },
    shubham: async () => { log.push("shubham"); },
    pranav: () => new Promise<void>((r) => { releaseDb = () => { log.push("db"); r(); }; }),
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(log).toEqual([]); // the frontend's only (last) phase waits for the backend, the backend for the database
  releaseDb();
  await done;
  expect(log).toEqual(["db", "shubham", "aanya"]);
});
