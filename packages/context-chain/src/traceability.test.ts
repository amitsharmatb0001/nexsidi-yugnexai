import { test, expect } from "bun:test";
import { buildTraceGraph, filesForRequirement, requirementsForFile, requirementsAffectedBy, tokenize, type TraceInput } from "./traceability.ts";
import type { CodeMap } from "./code-map.ts";

// Patent claim 3: a bidirectional traceability graph linking each piece of code back to the requirement it came from,
// and each requirement forward to the code that implements it.

const entry = (path: string) => ({ path, sha256: "x".repeat(64), lines: 1, language: "ts", imports: [], exports: [], symbols: [] });
const codeMap = (files: string[], edges: Array<[string, string]> = []): CodeMap => ({
  version: 1,
  files: files.map(entry),
  graph: { edges: edges.map(([from, to]) => ({ from, to })), external: {}, cycles: [] },
  rules: [],
  errorRecords: [],
  metadata: { fileCount: files.length, totalLines: files.length, languages: {} },
});

const input: TraceInput = {
  features: [
    { name: "Lead Capture & Inquiries", description: "Visitors send an inquiry through a contact form" },
    { name: "Client Authentication", description: "Clients sign up and sign in" },
    { name: "Client Dashboard Portal", description: "Signed-in clients see their projects" },
    { name: "Hidden Reporting Engine", description: "Nightly exports" },
  ],
  tasks: [
    { agent: "shubham", description: "Implement API routes for contact inquiries", outputFiles: ["src/routes/contact.ts", "src/controllers/contactController.ts"] },
    { agent: "shubham", description: "JWT auth middleware and sign-in routes for authentication", outputFiles: ["src/middleware/auth.ts"] },
    { agent: "aanya", description: "Dashboard page listing client projects", outputFiles: ["app/dashboard/page.tsx"] },
    { agent: "pranav", description: "Drizzle schema for users and inquiries", outputFiles: ["src/db/schema.ts"] },
  ],
};
const FILES = [
  "backend/src/routes/contact.ts",
  "backend/src/controllers/contactController.ts",
  "backend/src/middleware/auth.ts",
  "backend/src/db/schema.ts",
  "frontend/app/dashboard/page.tsx",
  "frontend/lib/format.ts",
];

test("tokenize lowercases, drops filler words and short words, and folds simple plurals", () => {
  expect(tokenize("Lead Capture & Inquiries for the Visitors")).toEqual(["lead", "capture", "inquiry", "visitor"]);
});

test("requirement ids are stable: the same name always gives the same id, whatever the order", () => {
  const a = buildTraceGraph(input, codeMap(FILES));
  const b = buildTraceGraph({ ...input, features: [...input.features].reverse() }, codeMap(FILES));
  const ids = (g: typeof a) => Object.fromEntries(g.requirements.map((r) => [r.name, r.id]));
  expect(ids(a)).toEqual(ids(b));
  expect(a.requirements[0]!.id).toMatch(/^REQ-[0-9a-f]{6}$/);
});

test("forward: a requirement leads to its tasks and then to the files that exist for them", () => {
  const g = buildTraceGraph(input, codeMap(FILES));
  const lead = g.requirements.find((r) => r.name.startsWith("Lead"))!;
  expect(filesForRequirement(g, lead.id)).toEqual(["backend/src/controllers/contactController.ts", "backend/src/routes/contact.ts", "backend/src/db/schema.ts"].sort());
});

test("backward: a file leads to the requirements it serves, with the reason for each link", () => {
  const g = buildTraceGraph(input, codeMap(FILES));
  const reqs = requirementsForFile(g, "backend/src/middleware/auth.ts");
  expect(reqs.map((r) => r.name)).toEqual(["Client Authentication"]);
  expect(reqs[0]!.reasons.join(" ")).toContain("authentication");
});

test("a requirement nothing implements is reported as untraced, and a file serving no requirement as unlinked", () => {
  const g = buildTraceGraph(input, codeMap(FILES));
  expect(g.untracedRequirements.map((id) => g.requirements.find((r) => r.id === id)!.name)).toEqual(["Hidden Reporting Engine"]);
  expect(g.unlinkedFiles).toEqual(["frontend/lib/format.ts"]);
});

test("a task whose declared files do not exist gives a requirement with no code, not an invented link", () => {
  const g = buildTraceGraph(input, codeMap(["frontend/lib/format.ts"]));
  const lead = g.requirements.find((r) => r.name.startsWith("Lead"))!;
  expect(filesForRequirement(g, lead.id)).toEqual([]);
  expect(g.untracedRequirements).toContain(lead.id);
});

test("task files are looked up under backend/, frontend/ and db/ for the agent that owns the task", () => {
  const g = buildTraceGraph(
    { features: [{ name: "Inventory Tracking", description: "stock levels" }], tasks: [{ agent: "pranav", description: "inventory tables migration", outputFiles: ["migrations/0001.sql"] }] },
    codeMap(["db/migrations/0001.sql"]),
  );
  expect(filesForRequirement(g, g.requirements[0]!.id)).toEqual(["db/migrations/0001.sql"]);
});

test("impact: changing a file affects its own requirements and those of every file that depends on it", () => {
  const map = codeMap(FILES, [["backend/src/controllers/contactController.ts", "backend/src/db/schema.ts"], ["frontend/app/dashboard/page.tsx", "frontend/lib/format.ts"]]);
  const g = buildTraceGraph(input, map);
  // schema.ts serves Lead Capture (by the inquiries task) and is imported by contactController.ts, which also serves Lead Capture.
  expect(requirementsAffectedBy(g, map, "backend/src/db/schema.ts").map((r) => r.name)).toEqual(["Lead Capture & Inquiries"]);
  // format.ts serves nothing itself, but the dashboard page imports it.
  expect(requirementsAffectedBy(g, map, "frontend/lib/format.ts").map((r) => r.name)).toEqual(["Client Dashboard Portal"]);
});

test("the graph is acyclic and deterministic: layered requirement to task to file, and the same input gives the same output", () => {
  const g1 = buildTraceGraph(input, codeMap(FILES));
  const g2 = buildTraceGraph(input, codeMap([...FILES].reverse()));
  expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  const kinds = new Set(g1.edges.map((e) => e.kind));
  expect([...kinds].sort()).toEqual(["requirement-task", "task-file"]);
});

test("words that name half the requirements do not link everything to everything", () => {
  const g = buildTraceGraph(input, codeMap(FILES));
  const auth = g.requirements.find((r) => r.name === "Client Authentication")!;
  const taskTexts = g.tasks.filter((t) => g.edges.some((e) => e.kind === "requirement-task" && e.from === auth.id && e.to === t.id)).map((t) => t.description);
  expect(taskTexts.every((d) => !d.startsWith("Dashboard"))).toBe(true);
});

test("a generated file that is not the one the plan named is still linked when its path words match the task, and says so", () => {
  const g = buildTraceGraph(
    { features: [{ name: "Lead Capture & Inquiries", description: "" }], tasks: [{ agent: "shubham", description: "Implement API routes for contact inquiries", outputFiles: ["src/routes/contactRoutes.ts"] }] },
    codeMap(["backend/src/routes/contact.ts", "backend/src/routes/other.ts", "frontend/app/contact/page.tsx"]),
  );
  const link = g.edges.find((e) => e.kind === "task-file" && e.to === "backend/src/routes/contact.ts");
  expect(link?.reason).toContain("contact");
  expect(link?.reason).toContain("not the file the plan named");
  // not linked: no matching words, and a file outside the folders of the agent that owns the task
  expect(g.edges.some((e) => e.to === "backend/src/routes/other.ts")).toBe(false);
  expect(g.edges.some((e) => e.to === "frontend/app/contact/page.tsx")).toBe(false);
});

test("generic file names (index, types, layout, config) are never linked on their own", () => {
  const g = buildTraceGraph(
    { features: [{ name: "Contact Inquiries", description: "" }], tasks: [{ agent: "shubham", description: "contact inquiries routes index types", outputFiles: [] }] },
    codeMap(["backend/src/routes/index.ts", "backend/src/types/requests.ts"]),
  );
  expect(g.edges.filter((e) => e.kind === "task-file")).toEqual([]);
});

test("file extensions are not words: every .tsx file does not match every task that names a .tsx file", () => {
  expect(tokenize("app/contact/page.tsx")).toEqual(["contact"]);
  const g = buildTraceGraph(
    { features: [{ name: "Home Banner", description: "" }], tasks: [{ agent: "aanya", description: "Home banner page", outputFiles: ["app/page.tsx"] }] },
    codeMap(["frontend/app/page.tsx", "frontend/app/about/page.tsx", "frontend/components/Footer.tsx"]),
  );
  expect(g.edges.filter((e) => e.kind === "task-file").map((e) => e.to)).toEqual(["frontend/app/page.tsx"]);
});
