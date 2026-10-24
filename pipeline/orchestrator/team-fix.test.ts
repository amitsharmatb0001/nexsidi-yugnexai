import { test, expect, afterEach } from "bun:test";
import { runFixAsTeam, fileOfFinding, type ScopedFix } from "./team-fix.ts";

// 2026-10-24 (builder teams, fix rounds): Brewline's frontend fix round took 23–31 model calls one after another for 5
// findings across 5 files. Findings are now grouped by the file they name; up to 3 helpers fix their own files at the
// same time (flash, own files only, type check only), then the lead (pro) handles findings without a file, anything a
// helper could not finish, and runs the full build and checks once.

const prev = process.env.NEXSIDI_BUILDER_TEAMS;
afterEach(() => {
  if (prev === undefined) delete process.env.NEXSIDI_BUILDER_TEAMS;
  else process.env.NEXSIDI_BUILDER_TEAMS = prev;
});

const F = [
  "frontend/components/layout/Header.tsx: the header shows My Orders for an expired token",
  "frontend/app/about/page.tsx: timeline dots overlap the year text",
  "frontend/components/layout/Footer.tsx: Sign in link shown when signed in",
  "frontend/middleware.ts: staff are redirected to /my-orders",
  "site-wide: the mono font is missing",
];

test("the file a finding names is found, relative to the builder's folder", () => {
  expect(fileOfFinding(F[0]!, "aanya")).toBe("components/layout/Header.tsx");
  expect(fileOfFinding("backend/src/controllers/orders.controller.ts:120 — [logic/HIGH] x", "shubham")).toBe("src/controllers/orders.controller.ts");
  expect(fileOfFinding(F[4]!, "aanya")).toBeNull();
});

test("helpers fix their own files at the same time, then the lead verifies everything once", async () => {
  const calls: Array<{ role?: string; findings: string[]; ownFiles?: string[] }> = [];
  let running = 0;
  let max = 0;
  const fix: ScopedFix = async (_plan, findings, team) => {
    calls.push({ role: team?.role, findings, ownFiles: team?.ownFiles });
    running++;
    max = Math.max(max, running);
    await new Promise((r) => setTimeout(r, team?.role === "helper" ? 5 : 1));
    running--;
    return { success: true, filesWritten: team?.ownFiles ?? [] };
  };
  const r = await runFixAsTeam("aanya", {} as never, F, fix);
  const helpers = calls.filter((c) => c.role === "helper");
  expect(helpers.length).toBe(3);
  expect(max).toBe(3);
  expect(calls[calls.length - 1]!.role).toBe("integrate");
  // every filed finding went to exactly one helper, which may write only that finding's file(s)
  const helped = helpers.flatMap((h) => h.findings);
  expect(helped.sort()).toEqual(F.slice(0, 4).sort());
  for (const h of helpers) for (const f of h.findings) expect(h.ownFiles).toContain(fileOfFinding(f, "aanya"));
  // the lead gets the finding without a file and a check line for each helper's fix
  const lead = calls[calls.length - 1]!.findings;
  expect(lead).toContain(F[4]);
  expect(lead.filter((l) => l.startsWith("ALREADY FIXED BY A HELPER")).length).toBe(4);
  expect(r.success).toBe(true);
});

test("a helper that fails hands its findings to the lead as open, not as fixed", async () => {
  const fix: ScopedFix = async (_p, findings, team) => ({ success: !(team?.role === "helper" && findings.some((f) => f.includes("about"))), filesWritten: [] });
  let leadFindings: string[] = [];
  await runFixAsTeam("aanya", {} as never, F, async (p, f, t) => { if (t?.role === "integrate") leadFindings = f; return fix(p, f, t); });
  expect(leadFindings).toContain(F[1]);
  expect(leadFindings.some((l) => l.startsWith("ALREADY FIXED BY A HELPER") && l.includes("about"))).toBe(false);
});

test("few findings, one file, or teams off: the single fix run as before", async () => {
  const roles: Array<string | undefined> = [];
  const fix: ScopedFix = async (_p, _f, t) => { roles.push(t?.role); return { success: true }; };
  await runFixAsTeam("aanya", {} as never, F.slice(0, 2), fix);
  await runFixAsTeam("aanya", {} as never, [F[0]!, F[0]!.replace("expired", "missing"), F[0]!.replace("expired", "old")], fix);
  process.env.NEXSIDI_BUILDER_TEAMS = "off";
  await runFixAsTeam("aanya", {} as never, F, fix);
  expect(roles).toEqual([undefined, undefined, undefined]);
});
