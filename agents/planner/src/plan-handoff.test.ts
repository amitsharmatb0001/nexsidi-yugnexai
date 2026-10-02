import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { PROPOSE_PLAN_TOOL, proposedPlanToBuildPlan, planToUserRequest, validatePlanPhases } from "./index.ts";
import type { ProposedPlan } from "./types.ts";

// 2026-10-02 (Ledgerly benchmark runs 2 and 3, approved by Amit): the plan
// had no place for rules, so "INV-2026-0001", "18%", "Draft, Sent or Paid"
// and "exact to the paisa" never reached the plan the user approved. And on
// approval only the name, summary, pages and design went to the build — the
// approved endpoints and tables were dropped too. The build must get the
// whole plan the user approved.

const PLAN: ProposedPlan = {
  appName: "Ledgerly",
  context: "GST invoicing for freelancers in India.",
  publicPages: [{ name: "Home", path: "/", description: "Landing page" }],
  protectedPages: [{ name: "Invoices", path: "/invoices", description: "List and search invoices" }],
  dbTables: [{ name: "invoices", keyColumns: ["user_id", "invoice_number", "status"] }],
  apiEndpoints: [{ method: "POST", path: "/api/v1/invoices", description: "Create an invoice" }],
  designDirection: "Deep midnight blue, amber call to action.",
  techStack: { frontend: "Next.js", backend: "Express", database: "PostgreSQL", auth: "JWT" },
  rules: [
    "Invoice numbers run in order per account: INV-2026-0001, INV-2026-0002, and so on.",
    "GST is 18% of the subtotal. Show subtotal, GST and total. Money must be exact to the paisa.",
  ],
};

test("the plan has a required rules list, copied word for word from the brief", () => {
  const params = PROPOSE_PLAN_TOOL.function.parameters as { required: string[]; properties: Record<string, { description?: string }> };
  expect(params.required).toContain("rules");
  expect(params.properties.rules!.description!.toLowerCase()).toContain("word for word");
});

test("approving the plan carries its rules, endpoints and tables into the build plan", () => {
  const built = proposedPlanToBuildPlan(PLAN);
  expect(built.rules).toEqual(PLAN.rules);
  expect(built.apiEndpoints).toEqual(PLAN.apiEndpoints);
  expect(built.dbTables).toEqual(PLAN.dbTables);
});

test("the build request contains every rule word for word, every endpoint and every table", () => {
  const request = planToUserRequest(proposedPlanToBuildPlan(PLAN));
  for (const rule of PLAN.rules) expect(request).toContain(rule);
  expect(request).toContain("POST /api/v1/invoices");
  expect(request).toContain("invoices: user_id, invoice_number, status");
  expect(request).toContain("Page: Invoices (/invoices)");
  expect(request).toContain("Design direction: Deep midnight blue");
});

test("the API starts the build from planToUserRequest, and the plan panel shows the rules", () => {
  const chat = readFileSync(new URL("../../../apps/api/src/routes/chat.ts", import.meta.url), "utf-8");
  expect(chat).toContain("planToUserRequest(");
  const page = readFileSync(new URL("../../../apps/web/app/build/[id]/page.tsx", import.meta.url), "utf-8");
  expect(page).toContain("plan.rules");
});

// 2026-10-02 (Part B.3, approved by Amit): the planner suggests what a senior
// team would add; the customer ticks what they want; only ticked ones are built.
const WITH_SUGGESTIONS: ProposedPlan = {
  ...PLAN,
  suggestedFeatures: [
    { name: "PDF invoices", why: "Clients expect a PDF they can forward to accounts", size: "medium" },
    { name: "CSV export for your accountant", why: "CAs file GST returns from a spreadsheet", size: "small" },
  ],
};

test("the plan can carry suggested features with why they matter, no fixed count", () => {
  const params = PROPOSE_PLAN_TOOL.function.parameters as { properties: Record<string, { items?: { required?: string[] }; maxItems?: number }> };
  const s = params.properties.suggestedFeatures!;
  expect(s.items!.required).toEqual(["name", "why", "size"]);
  expect(s.maxItems).toBeUndefined();
});

test("only the suggestions the customer ticked reach the build, word for word", () => {
  const request = planToUserRequest(proposedPlanToBuildPlan(WITH_SUGGESTIONS, ["PDF invoices"]));
  expect(request).toContain("PDF invoices — Clients expect a PDF they can forward to accounts");
  expect(request).not.toContain("CSV export for your accountant");
  // a name that was never suggested cannot be smuggled in
  expect(planToUserRequest(proposedPlanToBuildPlan(WITH_SUGGESTIONS, ["Admin panel"]))).not.toContain("Admin panel");
});

test("the plan panel shows suggestions as checkboxes and Accept sends the ticked ones", () => {
  const page = readFileSync(new URL("../../../apps/web/app/build/[id]/page.tsx", import.meta.url), "utf-8");
  expect(page).toContain("plan.suggestedFeatures");
  expect(page).toContain('type="checkbox"');
  expect(page).toContain("acceptedSuggestions");
  const chat = readFileSync(new URL("../../../apps/api/src/routes/chat.ts", import.meta.url), "utf-8");
  expect(chat).toContain("acceptedSuggestions");
});

test("the requirements skill says: never build what the user did not approve — propose extras instead", () => {
  const skill = readFileSync(new URL("../../../packages/agent-runtime/skills/library/requirements-coverage/SKILL.md", import.meta.url), "utf-8");
  expect(skill).not.toContain("Never add features the brief did not ask for");
  expect(skill).toContain("Never build what the user did not approve");
});

// Live check 2 Oct 2026: the planner's rules list kept only 11 lines and
// dropped about 7 of the brief's (sign-up, settings fields, client page, line
// items, dates, search, dashboard totals). The customer's whole brief now
// goes to the build word for word, guaranteed by code; the decisions made in
// the questions follow it and override it where they differ.
test("the build request carries the customer's whole brief word for word, then the decisions that override it", () => {
  const brief = "Build Ledgerly.\n- Each invoice has an issue date and a due date.\n- GST is 18% of the subtotal.";
  const request = planToUserRequest(proposedPlanToBuildPlan({ ...PLAN, rules: ["Auto-split CGST/SGST/IGST by client state"] }, [], brief));
  expect(request).toContain("Each invoice has an issue date and a due date.");
  expect(request).toContain("GST is 18% of the subtotal.");
  const b = request.indexOf("Each invoice has an issue date");
  const d = request.indexOf("Auto-split CGST/SGST/IGST");
  expect(b).toBeGreaterThan(-1);
  expect(d).toBeGreaterThan(b);
  expect(request.toLowerCase()).toContain("override the brief");
});

test("the planner keeps the customer's brief from the start of the conversation", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).toContain("state.brief");
});

// 2026-10-02 (Part C.1, approved by Amit): agents work in phases so they do
// not burn out and stay relevant. The planner divides the work into phases
// — as many as the app needs — and writes them in the plan so every agent
// refers to the same ones.
const PHASED: ProposedPlan = {
  ...PLAN,
  publicPages: [{ name: "Home", path: "/", description: "Landing" }],
  protectedPages: [{ name: "Clients", path: "/clients", description: "Clients" }, { name: "Invoices", path: "/invoices", description: "Invoices" }],
  apiEndpoints: [
    { method: "POST", path: "/api/v1/auth/sign-in", description: "Sign in" },
    { method: "GET", path: "/api/v1/clients", description: "List clients" },
    { method: "POST", path: "/api/v1/invoices", description: "Create invoice" },
  ],
  dbTables: [{ name: "users", keyColumns: ["email"] }, { name: "clients", keyColumns: ["name"] }, { name: "invoices", keyColumns: ["total"] }],
  buildPhases: [
    { name: "Foundation", goal: "Accounts and layout", pages: ["/"], endpoints: ["POST /api/v1/auth/sign-in"], tables: ["users"] },
    { name: "Clients", goal: "Manage clients", pages: ["/clients"], endpoints: ["GET /api/v1/clients"], tables: ["clients"] },
    { name: "Invoices", goal: "Create invoices", pages: ["/invoices"], endpoints: ["POST /api/v1/invoices"], tables: ["invoices"] },
  ],
};

test("the plan has build phases with their pages, endpoints and tables — no fixed number of phases", () => {
  const params = PROPOSE_PLAN_TOOL.function.parameters as { required: string[]; properties: Record<string, { maxItems?: number; minItems?: number; items?: { required?: string[] } }> };
  expect(params.required).toContain("buildPhases");
  expect(params.properties.buildPhases!.items!.required).toEqual(["name", "goal", "pages", "endpoints", "tables"]);
  expect(params.properties.buildPhases!.maxItems).toBeUndefined();
});

test("a plan whose phases cover every page, endpoint and table exactly once is accepted", () => {
  expect(validatePlanPhases(PHASED)).toEqual([]);
});

test("a plan with something in no phase, in two phases, or a phase naming something unknown is sent back", () => {
  const missing = { ...PHASED, buildPhases: PHASED.buildPhases!.slice(0, 2) };
  expect(validatePlanPhases(missing).join(" ")).toContain("/invoices");
  const twice = { ...PHASED, buildPhases: [...PHASED.buildPhases!, { name: "Extra", goal: "x", pages: ["/clients"], endpoints: [], tables: [] }] };
  expect(validatePlanPhases(twice).join(" ")).toContain("/clients");
  const unknown = { ...PHASED, buildPhases: [{ ...PHASED.buildPhases![0]!, pages: ["/", "/nowhere"] }, ...PHASED.buildPhases!.slice(1)] };
  expect(validatePlanPhases(unknown).join(" ")).toContain("/nowhere");
  expect(validatePlanPhases({ ...PHASED, buildPhases: [] }).length).toBeGreaterThan(0);
});

test("the build request lists the phases word for word, and the plan carries them for the pipeline", () => {
  const built = proposedPlanToBuildPlan(PHASED);
  expect(built.buildPhases).toEqual(PHASED.buildPhases);
  const request = planToUserRequest(built);
  expect(request).toContain("Build phases");
  expect(request).toContain("Phase 2 — Clients: Manage clients");
  expect(request).toContain("GET /api/v1/clients");
});

test("the planner checks the phases before showing a plan, the panel shows them, and the rules explain how to divide", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).toContain("validatePlanPhases(plan)");
  const page = readFileSync(new URL("../../../apps/web/app/build/[id]/page.tsx", import.meta.url), "utf-8");
  expect(page).toContain("plan.buildPhases");
  const rules = readFileSync(new URL("../INTAKE_RULES.md", import.meta.url), "utf-8");
  expect(rules).toContain("buildPhases");
  expect(rules.toLowerCase()).toContain("one focused session");
  expect(rules.toLowerCase()).toContain("as many phases as");
});
