import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { PROPOSE_PLAN_TOOL, proposedPlanToBuildPlan, planToUserRequest } from "./index.ts";
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
