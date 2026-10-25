import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetAppRateLimits } from "./limiter-reset.ts";

// 2026-10-25 (brewline2): the generated app limits sign-up and sign-in to 10 requests per 15 minutes per address, kept in
// memory. The system's own checks (round trip, role accounts, smoke test, page sweep, live reviewers) use that budget up
// in every round: they hit "429 Too many requests", and the customer's first real sign-up right after delivery would too.
// The backend of our own test instance is restarted before a round's account-making checks and after its test data is
// removed, which resets the in-memory counters. (A limiter that works is not switched off or edited in the app.)

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "limiter-"));
  writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
  return dir;
}

test("the backend container is restarted and the app is waited for until it answers", async () => {
  const dir = project();
  try {
    const cmds: string[] = [];
    let polls = 0;
    const r = await resetAppRateLimits(dir, "http://localhost:3302", {
      exec: (c) => { cmds.push(c); return ""; },
      fetchFn: (async () => new Response("{}", { status: ++polls < 3 ? 503 : 200 })) as unknown as typeof fetch,
      sleep: async () => {},
    });
    expect(r).toEqual({ ok: true });
    expect(cmds.length).toBe(1);
    expect(cmds[0]).toContain("docker compose");
    expect(cmds[0]).toContain("restart backend");
    expect(cmds[0]).toContain(join(dir, "docker-compose.yml"));
    expect(polls).toBe(3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a failed restart, a missing compose file or an app that never answers is reported, never thrown", async () => {
  const dir = project();
  try {
    const failed = await resetAppRateLimits(dir, "http://x", { exec: () => { throw new Error("no such service"); }, fetchFn: (async () => new Response("{}")) as unknown as typeof fetch, sleep: async () => {} });
    expect(failed.ok).toBe(false);
    const never = await resetAppRateLimits(dir, "http://x", { exec: () => "", fetchFn: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch, sleep: async () => {}, waitMs: 3 });
    expect(never.ok).toBe(false);
    const nofile = await resetAppRateLimits(join(dir, "missing"), "http://x", { exec: () => "", fetchFn: (async () => new Response("{}")) as unknown as typeof fetch, sleep: async () => {} });
    expect(nofile).toEqual({ ok: false, reason: "no docker-compose.yml" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a live round resets the limiter before its account-making checks and again after its test data is removed", () => {
  const src = readFileSync(new URL("./stage6-deployment.ts", import.meta.url), "utf-8");
  const fn = src.slice(src.indexOf("async function runRealLiveRetest"), src.indexOf("async function liveRetestChecks"));
  expect((fn.match(/resetAppRateLimits\(/g) ?? []).length).toBe(2);
  expect(fn.indexOf("resetAppRateLimits(")).toBeLessThan(fn.indexOf("liveRetestChecks("));
  expect(fn.lastIndexOf("resetAppRateLimits(")).toBeGreaterThan(fn.indexOf("purgeVerificationArtifacts("));
});

test("the deploy's own checks start with fresh counters too (a redeploy with an unchanged image keeps the old container)", () => {
  const riya = readFileSync(new URL("../../../agents/riya/src/index.ts", import.meta.url), "utf-8");
  expect(riya).toContain('limiter-reset.ts');
  const run = riya.slice(riya.indexOf("const migrationOk = applyMigrationsToDeployedDb(buildDir);") - 900, riya.indexOf("const migrationOk = applyMigrationsToDeployedDb(buildDir);"));
  expect(run).toContain("resetAppRateLimits(buildDir, backendUrl)");
});
