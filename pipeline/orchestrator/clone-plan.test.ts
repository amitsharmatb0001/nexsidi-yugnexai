import { test, expect } from "bun:test";
import { join } from "node:path";
import type { AgentName, ChatMessage, ModelId } from "@nexsidi/llm-client";
import { buildPlanPrompt, parseCloneChangePlan, planCloneChanges } from "./clone-plan.ts";

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
    return { content: JSON.stringify(response), modelUsed: "mistralai/mistral-nemotron" as ModelId };
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
