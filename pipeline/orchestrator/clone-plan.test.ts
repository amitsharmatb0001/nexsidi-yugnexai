import { test, expect } from "bun:test";
import { join } from "node:path";
import type { AgentName, ChatMessage, ModelId } from "@nexsidi/llm-client";
import { buildPlanPrompt, parseCloneChangePlan, planCloneChanges, expressScope, outOfScopeMessage, EXPRESS_MAX_NEW_TABLES, EXPRESS_MAX_NEW_PAGES } from "./clone-plan.ts";

// ── buildPlanPrompt (pure) ────────────────────────────────────────────────
test("buildPlanPrompt includes the change request and the real existing contract/schema", () => {
  const prompt = buildPlanPrompt(
    "add a wishlist feature",
    { endpoints: [{ method: "GET", path: "/api/v1/drops" }] },
    { tables: [{ name: "users" }] },
    "src/routes/orders.routes.ts",
    "components/DropFeed.tsx",
  );
  expect(prompt).toContain("add a wishlist feature");
  expect(prompt).toContain("/api/v1/drops");
  expect(prompt).toContain('"users"');
});

test("buildPlanPrompt includes the real frontend/backend file listings so the plan can name an exact file to model after", () => {
  const prompt = buildPlanPrompt(
    "add a wishlist feature",
    { endpoints: [] },
    { tables: [] },
    "src/routes/orders.routes.ts\nsrc/routes/index.ts",
    "components/DropFeed.tsx\napp/cart/page.tsx",
  );
  expect(prompt).toContain("src/routes/orders.routes.ts");
  expect(prompt).toContain("components/DropFeed.tsx");
  expect(prompt.toLowerCase()).toContain("model");
});

test("buildPlanPrompt handles an empty file listing without producing a blank/confusing section", () => {
  const prompt = buildPlanPrompt("reword the hero", { endpoints: [] }, { tables: [] }, "", "");
  expect(prompt).toContain("no backend files found");
  expect(prompt).toContain("no frontend files found");
});

// ── parseCloneChangePlan (pure) ───────────────────────────────────────────
test("parseCloneChangePlan parses a clean JSON response", () => {
  const raw = JSON.stringify({
    needsBackendChanges: true,
    reasoning: "no wishlist table exists",
    backendInstructions: "add a wishlist table and endpoints",
    frontendInstructions: "add a wishlist page",
  });
  const plan = parseCloneChangePlan(raw);
  expect(plan.needsBackendChanges).toBe(true);
  expect(plan.backendInstructions).toBe("add a wishlist table and endpoints");
  expect(plan.frontendInstructions).toBe("add a wishlist page");
});

test("parseCloneChangePlan parses a markdown-fenced JSON response — models often wrap JSON in ```json blocks", () => {
  const raw = '```json\n' + JSON.stringify({
    needsBackendChanges: false,
    reasoning: "purely cosmetic",
    backendInstructions: null,
    frontendInstructions: "reword the hero",
  }) + '\n```';
  const plan = parseCloneChangePlan(raw);
  expect(plan.needsBackendChanges).toBe(false);
  expect(plan.backendInstructions).toBeNull();
});

test("parseCloneChangePlan throws a clear error rather than silently guessing when required fields are missing", () => {
  expect(() => parseCloneChangePlan('{"reasoning": "incomplete response"}')).toThrow();
});

test("parseCloneChangePlan throws on genuinely unparseable text instead of returning a fabricated plan", () => {
  expect(() => parseCloneChangePlan("I cannot help with that request.")).toThrow();
});

// ── planCloneChanges (I/O + LLM call, all via DI) ────────────────────────
function makeFakeChat(response: { needsBackendChanges: boolean; reasoning: string; backendInstructions: string | null; frontendInstructions: string }) {
  const calls: { agentName: AgentName; messages: ChatMessage[] }[] = [];
  const chatFn = async (agentName: AgentName, messages: ChatMessage[], _apiKey: string) => {
    calls.push({ agentName, messages });
    return { content: JSON.stringify(response), modelUsed: "gemini-3.8-flash" as ModelId };
  };
  return { chatFn, calls };
}

test("planCloneChanges reads the real api-contract.json and db-schema.json and feeds them into the prompt", async () => {
  const buildDir = join("E:", "tmp", "nexsidi-builds", "clone1");
  const files: Record<string, string> = {
    [join(buildDir, "api-contract.json")]: JSON.stringify({ endpoints: [{ method: "GET", path: "/api/v1/drops" }] }),
    [join(buildDir, "db-schema.json")]: JSON.stringify({ tables: [{ name: "users" }] }),
  };
  const { chatFn, calls } = makeFakeChat({ needsBackendChanges: true, reasoning: "x", backendInstructions: "add wishlist table", frontendInstructions: "add wishlist page" });

  const plan = await planCloneChanges(
    { buildDir, changes: "add a wishlist", apiKey: "test-key" },
    { chatFn, existsFn: (p) => p in files, readFn: (p) => files[p]!, listFilesFn: () => "" },
  );

  expect(plan.needsBackendChanges).toBe(true);
  expect(calls[0]!.agentName).toBe("arjun");
  expect(calls[0]!.messages[0]!.content).toContain("/api/v1/drops");
  expect(calls[0]!.messages[0]!.content).toContain("add a wishlist");
});

test("planCloneChanges feeds the real frontend/backend file listing into the prompt via listFilesFn", async () => {
  const buildDir = join("E:", "tmp", "nexsidi-builds", "clone3");
  const { chatFn, calls } = makeFakeChat({ needsBackendChanges: true, reasoning: "x", backendInstructions: "add wishlist endpoints, model after src/routes/orders.routes.ts", frontendInstructions: "add wishlist page, model after components/DropFeed.tsx" });

  const listFilesFn = (dir: string) =>
    dir.endsWith("backend") ? "src/routes/orders.routes.ts\nsrc/routes/index.ts" : "components/DropFeed.tsx\napp/cart/page.tsx";

  await planCloneChanges(
    { buildDir, changes: "add a wishlist", apiKey: "test-key" },
    { chatFn, existsFn: () => false, readFn: () => "{}", listFilesFn },
  );

  expect(calls[0]!.messages[0]!.content).toContain("src/routes/orders.routes.ts");
  expect(calls[0]!.messages[0]!.content).toContain("components/DropFeed.tsx");
});

test("planCloneChanges degrades gracefully to an empty contract/schema when those files don't exist — older projects may lack them", async () => {
  const buildDir = join("E:", "tmp", "nexsidi-builds", "clone2");
  const { chatFn } = makeFakeChat({ needsBackendChanges: false, reasoning: "x", backendInstructions: null, frontendInstructions: "reword hero" });

  const plan = await planCloneChanges(
    { buildDir, changes: "reword the hero", apiKey: "test-key" },
    { chatFn, existsFn: () => false, readFn: () => { throw new Error("should not be called"); } },
  );

  expect(plan.needsBackendChanges).toBe(false);
});

// ── Scope: Express Build is a template with tweaks, not a fresh build ────────
// 2026-10-13 (Amit): "Express Build uses the logic of the older apps' backend and frontend like a template
// that we give tweaks — not a complete fresh build. Out of scope has to be refined or redirected to the
// fresh build, and the user told." Stockroom replaced a whole invoicing product and ran 18 minutes to a 502.
const planWith = (scope: object | undefined) =>
  JSON.stringify({ needsBackendChanges: true, reasoning: "r", backendInstructions: "b", frontendInstructions: "f", ...(scope ? { scope } : {}) });

test("the plan carries how big the change is: new tables, new pages, and whether it replaces what the app mainly does", () => {
  const plan = parseCloneChangePlan(planWith({ newTables: 5, newPages: 7, replacesCoreFeatures: true }));
  expect(plan.scope).toEqual({ newTables: 5, newPages: 7, replacesCoreFeatures: true });
});

test("a plan without scope numbers still parses, with scope unknown", () => {
  expect(parseCloneChangePlan(planWith(undefined)).scope).toBeNull();
  // junk numbers are not trusted
  expect(parseCloneChangePlan(planWith({ newTables: "many", newPages: -2, replacesCoreFeatures: "yes" })).scope).toBeNull();
});

test("the prompt asks for the scope numbers", () => {
  const prompt = buildPlanPrompt("tweak", { endpoints: [] }, { tables: [] }, "", "");
  expect(prompt).toContain("newTables");
  expect(prompt).toContain("newPages");
  expect(prompt).toContain("replacesCoreFeatures");
});

test("a tweak is in scope", () => {
  const r = expressScope(parseCloneChangePlan(planWith({ newTables: 1, newPages: 2, replacesCoreFeatures: false })));
  expect(r.inScope).toBe(true);
});

test("a change that replaces what the app mainly does is out of scope, whatever the counts", () => {
  const r = expressScope(parseCloneChangePlan(planWith({ newTables: 0, newPages: 0, replacesCoreFeatures: true })));
  expect(r.inScope).toBe(false);
  expect(r.reason).toMatch(/replace/i);
});

test("too many new tables or too many new pages is out of scope; the limits themselves are in", () => {
  expect(expressScope(parseCloneChangePlan(planWith({ newTables: EXPRESS_MAX_NEW_TABLES, newPages: 0, replacesCoreFeatures: false }))).inScope).toBe(true);
  expect(expressScope(parseCloneChangePlan(planWith({ newTables: EXPRESS_MAX_NEW_TABLES + 1, newPages: 0, replacesCoreFeatures: false }))).inScope).toBe(false);
  expect(expressScope(parseCloneChangePlan(planWith({ newTables: 0, newPages: EXPRESS_MAX_NEW_PAGES, replacesCoreFeatures: false }))).inScope).toBe(true);
  expect(expressScope(parseCloneChangePlan(planWith({ newTables: 0, newPages: EXPRESS_MAX_NEW_PAGES + 1, replacesCoreFeatures: false }))).inScope).toBe(false);
});

test("when the planner gave no scope numbers the request is let through, not blocked on a guess", () => {
  expect(expressScope(parseCloneChangePlan(planWith(undefined))).inScope).toBe(true);
});

test("the refusal tells the person why, what Express Build is for, and what to do instead", () => {
  const m = outOfScopeMessage("Ledgerly 2", "it needs 5 new database tables (Express Build takes up to 2)");
  expect(m).toContain("5 new database tables");
  expect(m).toContain("Ledgerly 2");
  expect(m.toLowerCase()).toContain("fresh build");
  expect(m.toLowerCase()).toContain("narrow");
});

test("the plan carries the accent colour the request names, as a hex, and null when it names none", () => {
  const withColour = JSON.stringify({ needsBackendChanges: false, reasoning: "r", backendInstructions: null, frontendInstructions: "f", accentColor: "#1D4ED8" });
  expect(parseCloneChangePlan(withColour).accentColor).toBe("#1D4ED8");
  const none = JSON.stringify({ needsBackendChanges: false, reasoning: "r", backendInstructions: null, frontendInstructions: "f", accentColor: null });
  expect(parseCloneChangePlan(none).accentColor).toBeNull();
  const junk = JSON.stringify({ needsBackendChanges: false, reasoning: "r", backendInstructions: null, frontendInstructions: "f", accentColor: "deep blue" });
  expect(parseCloneChangePlan(junk).accentColor).toBeNull();
});

test("the prompt asks for the accent colour", () => {
  expect(buildPlanPrompt("make it blue", { endpoints: [] }, { tables: [] }, "", "")).toContain("accentColor");
});
