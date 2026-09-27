import { test, expect } from "bun:test";
import { sanitizePlan, PROPOSE_PLAN_TOOL } from "./index.ts";
import type { BuildPlan } from "./types.ts";

// 2026-08-28: real bug found live (project 3887a86155bc). sanitizePlan used to
// auto-insert a public /sign-up page into ANY plan with authType "jwt" and a
// /sign-in. It runs AFTER the user approves, so the injected page never
// appeared in the plan they reviewed — they approved one thing and a different
// thing was committed to disk.
//
// Worse, every downstream safeguard then worked correctly against the wrong
// contract: Arjun's reconciliation saw /sign-up in the "locked" (approved)
// page list and guaranteed it was built, and Saanvi produced a matching public
// registration endpoint. Two rounds of prompt corrections could not override
// it, because the locked plan is authoritative by design.

const base: BuildPlan = {
  schemaVersion: "1",
  appName: "Admin Portal",
  appDescription: "Marketing site with a private admin area",
  authType: "jwt",
  pages: [
    { name: "Home", path: "/", description: "landing" },
    { name: "Sign In", path: "/sign-in", description: "admin login" },
    { name: "Admin", path: "/admin", description: "private dashboard" },
  ],
};

test("a jwt app with sign-in does NOT get a public sign-up page invented for it", () => {
  const out = sanitizePlan(base);
  expect(out.pages.map((p) => p.path)).toEqual(["/", "/sign-in", "/admin"]);
  expect(out.pages.some((p) => /sign-?up|register/i.test(p.path))).toBe(false);
});

test("an explicitly requested sign-up page is preserved — the user chose it", () => {
  const withSignUp: BuildPlan = {
    ...base,
    pages: [...base.pages, { name: "Sign Up", path: "/sign-up", description: "client registration" }],
  };
  expect(sanitizePlan(withSignUp).pages.map((p) => p.path)).toContain("/sign-up");
});

test("sanitizePlan still strips sign-out/logout — those are nav buttons, not pages", () => {
  const withSignOut: BuildPlan = {
    ...base,
    pages: [...base.pages, { name: "Sign Out", path: "/sign-out", description: "logout" }],
  };
  expect(sanitizePlan(withSignOut).pages.some((p) => /sign.?out/i.test(p.path))).toBe(false);
});

test("the committed page list matches the approved one exactly — nothing added", () => {
  // The core guarantee: what the user approves is what gets built.
  const approved = base.pages.map((p) => p.path);
  expect(sanitizePlan(base).pages.map((p) => p.path)).toEqual(approved);
});

// 2026-09-27: the plan preview told the user the frontend is
// "Next.js + @yugnex/nexui-react" — an old package that no longer exists;
// generated apps use @yugnex/core with components added by @yugnex/cli.
test("the plan preview's frontend stack is @yugnex/core, not the old @yugnex/nexui-react", () => {
  const schema = JSON.stringify(PROPOSE_PLAN_TOOL);
  expect(schema).not.toContain("@yugnex/nexui-react");
  expect(schema).toContain("@yugnex/core");
});
