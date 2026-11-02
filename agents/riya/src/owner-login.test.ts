import { test, expect, spyOn } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionOwnerLogins, readOwnerLogins, type OwnerLoginDeps } from "./owner-login.ts";

// 2026-11-02 (Brewline 8): every check passed, and no real staff member could sign in. The app made the staff account with a random
// password that nothing recorded; the checks signed in with a test account given the role. Before delivery the system now sets each
// role's real account a password, proves it by signing in and opening a page of that role, and keeps it for the owner.
function setup(over: Partial<OwnerLoginDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "owner-"));
  const hashes: Record<string, string> = {};
  const signIns: string[] = [];
  const deps: OwnerLoginDeps = {
    accounts: async () => ["staff@shop.local"],
    setPassword: async (email, password) => void (hashes[email] = password),
    signIn: async (email, password) => (signIns.push(email), hashes[email] === password ? "a-token" : null),
    rolePageStatus: async () => 200,
    ...over,
  };
  return { dir, deps, hashes, signIns, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("an app with no limited role needs no owner login", async () => {
  const s = setup();
  expect(await provisionOwnerLogins(s.dir, [], s.deps)).toEqual({ ok: true, logins: [] });
  expect(readOwnerLogins(s.dir)).toEqual([]);
  s.done();
});

test("the real account gets a password that really signs in and opens the role's page", async () => {
  const s = setup();
  const r = await provisionOwnerLogins(s.dir, ["staff"], s.deps);
  expect(r.ok).toBe(true);
  const [login] = readOwnerLogins(s.dir);
  expect(login!.role).toBe("staff");
  expect(login!.email).toBe("staff@shop.local");
  expect(login!.password.length).toBeGreaterThanOrEqual(16);
  expect(s.hashes["staff@shop.local"]).toBe(login!.password);
  s.done();
});

test("a later delivery keeps a password that still works", async () => {
  const s = setup();
  await provisionOwnerLogins(s.dir, ["staff"], s.deps);
  const first = readOwnerLogins(s.dir)[0]!.password;
  await provisionOwnerLogins(s.dir, ["staff"], s.deps);
  expect(readOwnerLogins(s.dir)[0]!.password).toBe(first);
  s.done();
});

test("no real account for a role is a fault, not a delivery", async () => {
  const s = setup({ accounts: async () => [] });
  const r = await provisionOwnerLogins(s.dir, ["staff"], s.deps);
  expect(r.ok).toBe(false);
  expect(r.ok ? "" : r.reason).toContain("staff");
  s.done();
});

test("a password that does not sign in is a fault", async () => {
  const s = setup({ signIn: async () => null });
  const r = await provisionOwnerLogins(s.dir, ["staff"], s.deps);
  expect(r.ok).toBe(false);
  expect(readOwnerLogins(s.dir)).toEqual([]);
  s.done();
});

test("signing in without reaching the role's page is a fault", async () => {
  const s = setup({ rolePageStatus: async () => 403 });
  const r = await provisionOwnerLogins(s.dir, ["staff"], s.deps);
  expect(r.ok).toBe(false);
  expect(r.ok ? "" : r.reason).toContain("403");
  s.done();
});

test("the password is never written to a log, and is kept outside what the customer's folders ship", async () => {
  const s = setup();
  const log = spyOn(console, "log");
  await provisionOwnerLogins(s.dir, ["staff"], s.deps);
  const password = readOwnerLogins(s.dir)[0]!.password;
  expect(JSON.stringify(log.mock.calls)).not.toContain(password);
  log.mockRestore();
  expect(existsSync(join(s.dir, ".nexsidi", "owner-login.json"))).toBe(true);
  s.done();
});

test("the deploy step fails a delivery whose owner login does not work, and the page can show it to the owner only", () => {
  const act = readFileSync(join(import.meta.dir, "../../../pipeline/activities/index.ts"), "utf-8");
  expect(act).toContain("provisionOwnerLoginFor(buildDirFor(projectId), result.appUrl)");
  const api = readFileSync(join(import.meta.dir, "../../../apps/api/src/routes/pipeline.ts"), "utf-8");
  expect(api).toMatch(/owner-login[\s\S]{0,400}project\.userId !== /);
  const page = readFileSync(join(import.meta.dir, "../../../apps/web/components/ide/IdeWorkspace.tsx"), "utf-8");
  expect(page).toContain("OwnerLoginCard");
});

test("the rules no longer tell a builder to log a generated password", () => {
  const skill = readFileSync(join(import.meta.dir, "../../../packages/agent-runtime/skills/shubham/20-critical-rules-and-verification.md"), "utf-8");
  expect(skill).not.toContain("a generated password\n    logged once");
  const checks = readFileSync(join(import.meta.dir, "../../../pipeline/orchestrator/stages/builder-exit-checks.ts"), "utf-8");
  expect(checks).not.toContain("a generated password logged once");
});
