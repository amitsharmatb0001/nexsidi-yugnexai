import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { assignTaskPhases, type PhaseTask } from "./phases.ts";

// 2026-10-02 (Part C.2, approved by Amit): every builder task carries the
// phase it belongs to, so builders work one focused phase at a time. Phases
// are assigned in code from the plan's own lists (pages, endpoints, tables)
// — a code match cannot skip or invent work. Tasks below are the real ones
// Arjun produced for the Ledgerly benchmark (project 1729c472b62d).

const PHASES = [
  { name: "Foundation", goal: "Accounts and settings", pages: ["/sign-up", "/sign-in", "/settings"], endpoints: ["POST /api/v1/auth/sign-up", "POST /api/v1/auth/sign-in", "GET /api/v1/users/me"], tables: ["users"] },
  { name: "Clients", goal: "Manage clients", pages: ["/clients", "/clients/:id"], endpoints: ["GET /api/v1/clients", "POST /api/v1/clients"], tables: ["clients"] },
  { name: "Invoices", goal: "Create invoices", pages: ["/invoices", "/invoices/new", "/invoices/:id"], endpoints: ["GET /api/v1/invoices", "POST /api/v1/invoices"], tables: ["invoices", "invoice_items"] },
  { name: "Dashboard", goal: "Monthly summary", pages: ["/", "/dashboard"], endpoints: ["GET /api/v1/dashboard"], tables: [] },
];

const plan = () => ({
  shubhamTasks: [
    { description: "Setup Express server, JWT auth middleware, and error handling structure.", outputFiles: ["src/index.ts", "src/app.ts", "src/middleware/auth.ts", "package.json"] },
    { description: "Implement authentication endpoints: POST /api/v1/auth/sign-up and POST /api/v1/auth/sign-in.", outputFiles: ["src/routes/auth.ts", "src/controllers/authController.ts"] },
    { description: "Implement Settings endpoints (GET, PATCH) for managing Business Profiles.", outputFiles: ["src/routes/settings.ts", "src/controllers/settingsController.ts"] },
    { description: "Implement Client endpoints (GET all, POST, GET by id, PATCH, DELETE) with strict user_id filtering.", outputFiles: ["src/routes/clients.ts", "src/controllers/clientsController.ts"] },
    { description: "Implement POST /api/v1/invoices with the counters table for INV-YYYY-XXXX numbers.", outputFiles: ["src/routes/invoiceCreation.ts", "src/services/invoiceService.ts"] },
    { description: "Implement Dashboard endpoint fetching total invoiced this month and latest invoices.", outputFiles: ["src/routes/dashboard.ts", "src/controllers/dashboardController.ts"] },
  ] as PhaseTask[],
  aanyaTasks: [
    { description: "Landing page", outputFiles: ["app/page.tsx"] },
    { description: "Sign up", outputFiles: ["app/(auth)/sign-up/page.tsx"] },
    { description: "Dashboard", outputFiles: ["app/dashboard/page.tsx", "components/DashboardMetrics.tsx"] },
    { description: "Clients list", outputFiles: ["app/clients/page.tsx", "components/ClientList.tsx"] },
    { description: "Client details", outputFiles: ["app/clients/[id]/page.tsx"] },
    { description: "New invoice", outputFiles: ["app/invoices/new/page.tsx", "components/InvoiceForm.tsx"] },
    { description: "Settings", outputFiles: ["app/settings/page.tsx", "components/BusinessProfileForm.tsx"] },
    { description: "Shared header and footer", outputFiles: ["components/Header.tsx", "components/Footer.tsx"] },
  ] as PhaseTask[],
  pranavTasks: [{ description: "Drizzle schema for users, clients, invoices, invoice_items and counters", outputFiles: ["schema.ts"] }] as PhaseTask[],
});

test("frontend tasks follow their page's phase; shared pieces go to phase 1", () => {
  const p = plan();
  assignTaskPhases(p, PHASES);
  expect(p.aanyaTasks.map((t) => t.phase)).toEqual([4, 1, 4, 2, 2, 3, 1, 1]);
});

test("backend tasks follow their resource's phase — file names count more than the description", () => {
  const p = plan();
  assignTaskPhases(p, PHASES);
  // server setup → 1, auth → 1, settings → 1 (the /settings page), clients → 2, invoices → 3, dashboard → 4
  expect(p.shubhamTasks.map((t) => t.phase)).toEqual([1, 1, 1, 2, 3, 4]);
});

test("the database schema is built whole in phase 1, so every later phase can rely on it", () => {
  const p = plan();
  assignTaskPhases(p, PHASES);
  expect(p.pranavTasks.map((t) => t.phase)).toEqual([1]);
});

test("every task gets a size from its own work, used to size each phase's step budget", () => {
  const p = plan();
  assignTaskPhases(p, PHASES);
  for (const t of [...p.shubhamTasks, ...p.aanyaTasks, ...p.pranavTasks]) {
    expect(t.size).toBeGreaterThanOrEqual(1);
  }
  expect(p.shubhamTasks[0]!.size).toBeGreaterThan(p.aanyaTasks[4]!.size!); // 4 files vs 1 file
});

test("Arjun tags the tasks before the plan hash is made, and the pipeline passes the planner's phases in", () => {
  const arjun = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  const assign = arjun.indexOf("assignTaskPhases(");
  const hash = arjun.indexOf("buildPlanHash: hashContext(plan)");
  expect(assign).toBeGreaterThan(0);
  expect(assign).toBeLessThan(hash);
  const activities = readFileSync(new URL("../../../pipeline/activities/index.ts", import.meta.url), "utf-8");
  expect(activities).toContain("plannerPlan?.buildPhases");
});
