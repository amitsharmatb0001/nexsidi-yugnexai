import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testerPrompt, writeAcceptanceTests } from "./index.ts";
import { readAcceptanceTests } from "../../../../pipeline/orchestrator/acceptance-tests.ts";

// 2026-10-29 (team plan, stage 3): the tester writes each phase's acceptance tests from the approved plan before any code
// exists. The Chief AI's check refuses a test outside the plan; the tester is shown why and corrects it (twice at most).
// A phase it cannot write tests for is recorded, never guessed, and never stops the build.

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aarav-"));
  writeFileSync(join(dir, "user-request.txt"), "Brewline: a coffee shop. Customers pre-order drinks for 15-minute pickup slots.");
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ successCriteria: ["Customers can sign up (/sign-up) and sign in (/sign-in).", "Staff manage the menu on /staff/menu."] }));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/auth/sign-up", description: "Customer registration.", requestType: "{ email: string; password: string }", responseType: "{ token: string; user: { id: string; role: 'customer' | 'staff' } }" },
    { method: "POST", path: "/api/v1/auth/sign-in", description: "Sign in.", requestType: "{ email: string; password: string }", responseType: "{ token: string }" },
    { method: "POST", path: "/api/v1/menu", description: "Create a menu item. Restricted to authenticated staff accounts.", requestType: "{ name: string; price: number }", responseType: "{ id: string; name: string; price: number }" },
  ] }));
  writeFileSync(join(dir, "build-plan.json"), JSON.stringify({ buildPhases: [
    { name: "Foundation", goal: "Customers can sign up and sign in", pages: ["/sign-up", "/sign-in"], endpoints: ["POST /api/v1/auth/sign-up", "POST /api/v1/auth/sign-in"], tables: ["users"] },
    { name: "Menu", goal: "Staff manage the menu", pages: ["/staff/menu"], endpoints: ["POST /api/v1/menu"], tables: ["menu_items"] },
  ] }));
  writeFileSync(join(dir, "planner-plan.json"), JSON.stringify({ pages: [
    { path: "/sign-up", name: "Sign Up", description: "Customer account creation" },
    { path: "/sign-in", name: "Sign In", description: "Customer and staff sign-in" },
    { path: "/staff/menu", name: "Staff Menu", description: "Staff add and edit menu items" },
  ] }));
  writeFileSync(join(dir, "build-answers.jsonl"), JSON.stringify({ question: "What are the store hours?", answer: "7:00–18:00 every day", source: "customer", askedBy: "aanya", at: "t" }) + "\n");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const signUpApi = { planItem: "SC1", title: "a new customer can sign up", as: "anyone", kind: "api", steps: [{ method: "POST", path: "/api/v1/auth/sign-up", body: { email: "{{email}}", password: "{{password}}" }, expectStatus: [200, 201], expectBody: [{ path: "token", exists: true }] }] };
const signInApi = { planItem: "EP2", title: "a customer can sign in", as: "anyone", kind: "api", steps: [
  { method: "POST", path: "/api/v1/auth/sign-up", body: { email: "{{email}}", password: "{{password}}" }, expectStatus: [200, 201] },
  { method: "POST", path: "/api/v1/auth/sign-in", body: { email: "{{email}}", password: "{{password}}" }, expectStatus: 200 },
] };
const signUpPage = { planItem: "SC1", title: "a visitor signs up on the page", as: "anyone", kind: "journey", steps: [{ do: "open", path: "/sign-up" }, { do: "fill", field: "Email", value: "{{email}}" }, { do: "fill", field: "Password", value: "{{password}}" }, { do: "click", text: "Create account" }] };
const signInPage = { planItem: "SC1", title: "the sign-in page asks for email and password", as: "anyone", kind: "journey", steps: [{ do: "open", path: "/sign-in" }, { do: "see", text: "Sign in" }] };
const staffAdds = { planItem: "EP3", title: "staff add a menu item", as: "staff", kind: "api", steps: [{ method: "POST", path: "/api/v1/menu", body: { name: "Mocha {{unique}}", price: 5 }, expectStatus: 201, save: { id: "id" } }] };
const customerCannotAdd = { planItem: "SEC1", title: "a customer cannot add a menu item", as: "user", kind: "api", steps: [{ method: "POST", path: "/api/v1/menu", body: { name: "x", price: 1 }, expectStatus: [401, 403] }] };
const staffMenuPage = { planItem: "SC2", title: "staff open the menu page", as: "staff", kind: "journey", steps: [{ do: "open", path: "/staff/menu" }, { do: "see", text: "Menu" }] };

test("the tester's task holds the phase, the plan items, the contract shapes, the people and the answers given", () => {
  const p = testerPrompt(dir, 2);
  expect(p).toContain("PHASE 2 of 2 — Menu: Staff manage the menu");
  expect(p).toContain("Earlier phases (already built when this phase is tested): 1. Foundation");
  expect(p).toContain("[SC2] Staff manage the menu on /staff/menu.");
  expect(p).toContain("[INT1]");
  expect(p).toContain("POST /api/v1/menu");
  expect(p).toContain("request { name: string; price: number }");
  expect(p).toContain('"anyone", "user", "staff"');
  expect(p).toContain("What are the store hours? → 7:00–18:00 every day");
  expect(p).toContain("/staff/menu (phase 2) — Staff add and edit menu items");
  expect(p).toContain("{{datetime+N HH:MM}}");
});

test("tests are numbered and placed by the system; a test outside the plan is sent back with the reason and corrected", async () => {
  const prompts: string[] = [];
  const answers = [
    JSON.stringify([signUpApi, signInApi, signUpPage, { ...signInPage, planItem: "SC9" }]),
    "Here you go:\n```json\n" + JSON.stringify([signInPage]) + "\n```",
    JSON.stringify([staffAdds, customerCannotAdd, staffMenuPage]),
  ];
  const suite = await writeAcceptanceTests(dir, { chat: async (p) => (prompts.push(p), answers.shift()!) });
  expect(suite.tests.map((t) => [t.id, t.phase, t.planItem])).toEqual([
    ["AT-1-1", 1, "SC1"], ["AT-1-2", 1, "EP2"], ["AT-1-3", 1, "SC1"], ["AT-1-4", 1, "SC1"],
    ["AT-2-1", 2, "EP3"], ["AT-2-2", 2, "SEC1"], ["AT-2-3", 2, "SC2"],
  ]);
  expect(prompts[1]).toContain("SC9 is not an item of the approved plan");
  expect(suite.rejected).toEqual([]);
  expect(suite.gaps).toEqual([]);
  expect(readAcceptanceTests(dir)?.tests.length).toBe(7);
});

test("an endpoint or page of the phase with no test is asked for, and recorded when still missing", async () => {
  const prompts: string[] = [];
  const answers = [
    JSON.stringify([signUpApi, signUpPage]),
    JSON.stringify([signInApi]),
    JSON.stringify([]),
    JSON.stringify([staffAdds, staffMenuPage]),
  ];
  const suite = await writeAcceptanceTests(dir, { chat: async (p) => (prompts.push(p), answers.shift() ?? "[]") });
  expect(prompts[1]).toContain("No test yet for: POST /api/v1/auth/sign-in, the page /sign-in");
  expect(prompts[2]).toContain("No test yet for: the page /sign-in");
  expect(suite.gaps).toEqual([{ phase: 1, missing: ["the page /sign-in"] }]);
  expect(suite.tests.filter((t) => t.phase === 1).length).toBe(3);
});

test("a phase the tester cannot answer for is recorded as not written, and the other phases still get tests", async () => {
  let call = 0;
  const suite = await writeAcceptanceTests(dir, {
    chat: async () => {
      call++;
      if (call <= 2) return "I cannot do that";
      if (call === 3) throw new Error("all pool models exhausted");
      return JSON.stringify([staffAdds, staffMenuPage]);
    },
  });
  expect(suite.notWritten).toEqual([{ phase: 1, reason: expect.stringContaining("no JSON list of tests") }]);
  expect(suite.tests.map((t) => t.id)).toEqual(["AT-2-1", "AT-2-2"]);
});

test("a tester that fails outright leaves a record, not an exception", async () => {
  const suite = await writeAcceptanceTests(dir, { chat: async () => { throw new Error("quota"); } });
  expect(suite.tests).toEqual([]);
  expect(suite.notWritten.map((n) => n.phase)).toEqual([1, 2]);
  expect(suite.notWritten[0]!.reason).toContain("quota");
  expect(readAcceptanceTests(dir)?.notWritten.length).toBe(2);
});
