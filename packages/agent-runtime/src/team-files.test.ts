import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { helperWritable, leadSharedWritable } from "./team-files.ts";
import { teamRunOverrides, missingFiles } from "./team-files.ts";
import { readFileSync } from "node:fs";

// 2026-10-24 (builder teams): helpers of one builder write at the same time, so each may write only its own work — its
// tasks' files (from the approved plan), new files in its tasks' folders, and tests beside them. Shared files and other
// helpers' files are refused by the existing write guard. The lead's shared-files step may not write any task's files.

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function folder(): string {
  dir = mkdtempSync(join(tmpdir(), "team-"));
  for (const f of ["components/layout/Header.tsx", "lib/api.ts", "app/order/page.tsx"]) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "x");
  }
  return dir;
}

test("a helper may write its own task files, new files in its own folders, and tests beside them — nothing else", () => {
  const can = helperWritable(folder(), ["app/menu/page.tsx", "components/menu/MenuGrid.tsx"]);
  expect(can("app/menu/page.tsx")).toBe(true);
  expect(can("components/menu/MenuGrid.tsx")).toBe(true);
  expect(can("components/menu/MenuBadge.tsx")).toBe(true); // new, in its own folder
  expect(can("components/menu/MenuGrid.test.ts")).toBe(true);
  expect(can("lib/api.ts")).toBe(false); // shared, exists
  expect(can("components/layout/Header.tsx")).toBe(false); // shared, exists
  expect(can("app/order/page.tsx")).toBe(false); // another helper's
  expect(can("components/staff/StaffBoard.tsx")).toBe(false); // new, but not in its folders
});

test("the lead's shared-files step may write anything except the tasks' own files", () => {
  const can = leadSharedWritable(["app/menu/page.tsx", "components/menu/MenuGrid.tsx"]);
  expect(can("components/layout/Header.tsx")).toBe(true);
  expect(can("lib/api.ts")).toBe(true);
  expect(can("app/menu/page.tsx")).toBe(false);
});


test("team settings: helpers on the flash tier starting on their own model, type check only, no containers or browser", async () => {
  const d = folder();
  const o = teamRunOverrides({ role: "helper", helperIndex: 2, ownFiles: ["app/menu/page.tsx"] }, d, { taskFiles: ["app/menu/page.tsx"] });
  expect(o.geminiTier).toBe("generation");
  expect(o.firstModelIndex).toBe(2);
  expect(o.requiredVerificationCommands).toEqual(["npx tsc --noEmit"]);
  expect(o.requiredEvidenceKinds).toEqual([]);
  expect([o.enableDockerTools, o.enableHttpTools, o.enableBrowser]).toEqual([false, false, false]);
  expect(o.writableFile!("lib/api.ts")).toBe(false);
  expect(await o.exitChecks!()).toEqual(["app/menu/page.tsx is in your tasks but was not written"]);
});

test("team settings: the lead runs on the pro tier; its finish check compares the code to the plan and keeps the phase's own checks", async () => {
  const d = folder();
  expect(teamRunOverrides({ role: "shared", avoidFiles: ["app/order/page.tsx"] }, d, { taskFiles: [] }).geminiTier).toBe("design");
  const lead = teamRunOverrides({ role: "integrate" }, d, { taskFiles: ["app/order/page.tsx", "app/menu/page.tsx"], baseExitChecks: () => ["emoji on line 3"] });
  expect(lead.geminiTier).toBe("design");
  expect(await lead.exitChecks!()).toEqual(["app/menu/page.tsx is in your tasks but was not written", "emoji on line 3"]);
  expect(teamRunOverrides(undefined, d, { taskFiles: [] })).toEqual({});
  expect(missingFiles(d, ["app/order/page.tsx"])).toEqual([]);
});

test("both builders apply the team settings, and the loop starts a helper on its own model", () => {
  for (const b of ["aanya", "shubham"]) {
    const src = readFileSync(new URL(`../../../agents/generators/${b}/src/index.ts`, import.meta.url), "utf-8");
    expect({ b, ok: src.includes("...teamRunOverrides(phase,") }).toEqual({ b, ok: true });
  }
  const loop = readFileSync(new URL("./gemini-loop.ts", import.meta.url), "utf-8");
  expect(loop).toContain("firstModelIndex: config.firstModelIndex");
});
