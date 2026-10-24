import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-24 (docs/root-cause/2026-10-24-brewline.md): both builders had to finish phase N before either started N+1;
// the backend builder sat idle 54 of its 86 minutes. Now each builder runs its own phases straight through. Two waits
// stay because something really depends on them: the backend's phase 2 waits for the database step (as before), and the
// frontend's LAST phase — the only one with the whole-app browser check — waits for the finished backend.

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("each builder runs its phases without waiting for the other; only the frontend's last phase waits for the backend", async () => {
  const { runBuildPhases } = await import("./project-build.ts") as unknown as {
    runBuildPhases: (n: number, run: { aanya: (p: number) => Promise<void>; shubham?: (p: number) => Promise<void>; pranav?: () => Promise<void> }) => Promise<void>;
  };
  const log: string[] = [];
  await runBuildPhases(4, {
    // a fast frontend and a slow backend, as on Brewline
    aanya: async (p) => { log.push(`aanya ${p} start`); await delay(5); log.push(`aanya ${p} end`); },
    shubham: async (p) => { log.push(`shubham ${p} start`); await delay(20); log.push(`shubham ${p} end`); },
    pranav: async () => { log.push("pranav start"); await delay(2); log.push("pranav end"); },
  });
  const at = (s: string) => log.indexOf(s);
  // The frontend reaches its phase 3 long before the backend finishes phase 2 — no lockstep.
  expect(at("aanya 3 end")).toBeLessThan(at("shubham 2 end"));
  // The frontend's last phase starts only after the whole backend is done.
  expect(at("aanya 4 start")).toBeGreaterThan(at("shubham 4 end"));
  // The backend's phase 2 still starts after the database step.
  expect(at("shubham 2 start")).toBeGreaterThan(at("pranav end"));
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
