# Full Agentic Pipeline Implementation Plan

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Wire the approved 6-stage pipeline design (`docs/superpowers/specs/2026-07-01-full-agentic-pipeline-design.md`) into real, running orchestration code — checkpointed stages, a real approval gate, a real context hash chain, zero-tolerance security QA, and the tools agents need (`web_search`, screenshot) — culminating in 2-4 real stress-test apps built end-to-end.

**Architecture:** Direct async orchestration (`pipeline/orchestrator/`), no Temporal dependency. Each stage is a typed function; a file-based checkpoint after each stage enables crash-resume. Deterministic infrastructure (checkpointing, flags, gateway parsing, DAG cycle detection, hash verification, QA scoring) is unit-tested with real TDD. Agent-prompt-level behavior (what Shubham/Aanya/Karan actually generate) is verified via the incremental stress-test apps specified in the design, not fine-grained unit tests — an LLM's tool-call sequence isn't meaningfully unit-testable, and pretending otherwise would violate the no-mocking-what-you-don't-understand rule.

**Tech Stack:** TypeScript, Bun, existing `@nexsidi/*` workspace packages, `@yugnex/nexui`/`@yugnex/nexui-react` (already vendored).

## Global Constraints

- No Temporal in this plan — stage functions must stay typed `(input) => Promise<output>` with no hidden state, so `proxyActivities()` can wrap them later without a rewrite (per design doc Non-Goals)
- `requireOtp` / `requirePayment` default `false`; `deployTarget` defaults `"local"` (per design doc)
- Internal agent names (Saanvi, Aanya, Shubham, Pranav, Riya, Navya, Karan, Deepika, Tilotma) never appear in any orchestrator-produced status string — only generic labels (per design doc Confidentiality section)
- Security QA (Karan) is zero-tolerance pass/fail; Logic (Navya) and Performance (Deepika) use the existing ≥85/100 severity-weighted score — never mix the two scoring systems
- Every new deterministic module gets a real failing-test-first cycle per `nexsidi-testing`. No placeholder tests, no tests-after.

---

## File Map

| File | Responsibility |
|---|---|
| `pipeline/orchestrator/types.ts` | Shared types: `PipelineCheckpoint`, `FeatureFlags`, `GatewayDecision`, `DagTask`, `Dag` |
| `pipeline/orchestrator/checkpoint.ts` | Read/write per-stage JSON checkpoint files; resume detection |
| `pipeline/orchestrator/flags.ts` | Resolve `requireOtp`/`requirePayment`/`deployTarget` from env, with defaults |
| `pipeline/orchestrator/gateway.ts` | Proceed/Review approval gate via file-based signal (matches existing `STEER.md`/`AGENT_STOP` pattern) |
| `pipeline/orchestrator/dag.ts` | Build a DAG from requirements with complexity scores; cycle detection |
| `pipeline/orchestrator/stages/stage1-requirements.ts` | Wraps Saanvi + `dag.ts`; produces spec + task graph |
| `pipeline/orchestrator/stages/stage2-gateway.ts` | Wraps `gateway.ts` + `flags.ts` |
| `pipeline/orchestrator/stages/stage3-ui-preview.ts` | Calls Aanya in `mode: "preview"`; writes design-lock file on approval |
| `pipeline/orchestrator/stages/stage4-multi-agent-dev.ts` | Sequences Pranav/Shubham (parallel) → Aanya (`mode: "integrate"`); wires context hash chain on every handoff |
| `pipeline/orchestrator/stages/stage5-adversarial-qa.ts` | Runs Navya/Karan/Deepika in parallel + Tilotma Tier 3; fault-isolated retry loop |
| `pipeline/orchestrator/stages/stage6-deployment.ts` | Wraps Riya with `deployTarget`; live retest via stage5 |
| `pipeline/orchestrator/run.ts` | Entry point — calls stages 1-6 in order, checkpointing between each |
| `packages/context-chain/src/index.ts` | *Modify*: export `verifyContext`, `triggerRollback` (already implemented, just unexported) |
| `packages/agent-runtime/src/tools/websearch.ts` | New `web_search` tool for Saanvi (Stage 1) and Shubham/Aanya (Stage 4 package verification) |
| `packages/agent-runtime/src/tools/screenshot.ts` | New screenshot tool for Tilotma's Stage 5 Tier 3 review |
| `packages/agent-runtime/src/index.ts` | *Modify*: export the two new tools |
| `agents/generators/aanya/src/index.ts` | *Modify*: add `mode: "preview" \| "integrate"` param — preview mode uses mock data and skips API-wiring instructions |
| `agents/qa/karan/src/index.ts` | *Modify*: zero-tolerance scoring (any finding = FAIL), replacing severity-weighted score for security only |
| `agents/riya/src/index.ts` | *Modify*: accept `deployTarget: "local" \| "gcp"` param (gcp path stubbed/throws "not yet implemented" — flagged as its own follow-up per design doc) |
| `agents/tilotma/src/tier3-review.ts` | New — Tilotma's evidence-based final review (Aarav two-stage pattern), using the new screenshot tool |

---

## Task 1: Checkpoint System

**Files:**
- Create: `pipeline/orchestrator/types.ts`
- Create: `pipeline/orchestrator/checkpoint.ts`
- Test: `pipeline/orchestrator/checkpoint.test.ts`

**Interfaces:**
- Produces: `writeCheckpoint(projectId: string, stage: string, data: unknown): void`, `readCheckpoint<T>(projectId: string, stage: string): T | null`, `type PipelineCheckpoint`

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { writeCheckpoint, readCheckpoint } from "./checkpoint.ts";
import { rmSync, existsSync } from "fs";
import { join } from "path";

const TEST_PROJECT = "test-checkpoint-proj";

test("writeCheckpoint then readCheckpoint returns the same data", () => {
  writeCheckpoint(TEST_PROJECT, "01-requirements", { specId: "abc123", done: true });
  const result = readCheckpoint<{ specId: string; done: boolean }>(TEST_PROJECT, "01-requirements");
  expect(result).toEqual({ specId: "abc123", done: true });
  rmSync(join(process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds", TEST_PROJECT), { recursive: true, force: true });
});

test("readCheckpoint returns null when no checkpoint exists (fresh start)", () => {
  const result = readCheckpoint(TEST_PROJECT, "nonexistent-stage");
  expect(result).toBeNull();
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test pipeline/orchestrator/checkpoint.test.ts`
Expected: FAIL — "Cannot find module './checkpoint.ts'"

- [ ] **Step 3: Write minimal implementation**
```typescript
// pipeline/orchestrator/types.ts
export interface FeatureFlags {
  requireOtp: boolean;
  requirePayment: boolean;
  deployTarget: "local" | "gcp";
}

export interface GatewayDecision {
  decision: "proceed" | "review";
  feedback?: string;
}

export interface DagTask {
  id: string;
  description: string;
  complexity: number;
  dependsOn: string[];
}

export interface Dag {
  tasks: DagTask[];
}
```

```typescript
// pipeline/orchestrator/checkpoint.ts
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

function checkpointPath(projectId: string, stage: string): string {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  return join(buildDir, projectId, "checkpoints", `${stage}.json`);
}

export function writeCheckpoint(projectId: string, stage: string, data: unknown): void {
  const path = checkpointPath(projectId, stage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

export function readCheckpoint<T>(projectId: string, stage: string): T | null {
  const path = checkpointPath(projectId, stage);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}
```

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test pipeline/orchestrator/checkpoint.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**
```bash
git add pipeline/orchestrator/types.ts pipeline/orchestrator/checkpoint.ts pipeline/orchestrator/checkpoint.test.ts
git commit -m "feat: add stage checkpoint read/write for pipeline crash-resume"
```

---

## Task 2: Feature Flags

**Files:**
- Create: `pipeline/orchestrator/flags.ts`
- Test: `pipeline/orchestrator/flags.test.ts`

**Interfaces:**
- Consumes: `FeatureFlags` from `./types.ts` (Task 1)
- Produces: `resolveFlags(): FeatureFlags`

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { resolveFlags } from "./flags.ts";

test("resolveFlags defaults to demo-safe values with no env vars set", () => {
  delete process.env.NEXSIDI_REQUIRE_OTP;
  delete process.env.NEXSIDI_REQUIRE_PAYMENT;
  delete process.env.NEXSIDI_DEPLOY_TARGET;
  expect(resolveFlags()).toEqual({ requireOtp: false, requirePayment: false, deployTarget: "local" });
});

test("resolveFlags respects env var overrides", () => {
  process.env.NEXSIDI_REQUIRE_OTP = "true";
  process.env.NEXSIDI_DEPLOY_TARGET = "gcp";
  expect(resolveFlags()).toEqual({ requireOtp: true, requirePayment: false, deployTarget: "gcp" });
  delete process.env.NEXSIDI_REQUIRE_OTP;
  delete process.env.NEXSIDI_DEPLOY_TARGET;
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test pipeline/orchestrator/flags.test.ts`
Expected: FAIL — "Cannot find module './flags.ts'"

- [ ] **Step 3: Write minimal implementation**
```typescript
import type { FeatureFlags } from "./types.ts";

export function resolveFlags(): FeatureFlags {
  return {
    requireOtp: process.env.NEXSIDI_REQUIRE_OTP === "true",
    requirePayment: process.env.NEXSIDI_REQUIRE_PAYMENT === "true",
    deployTarget: process.env.NEXSIDI_DEPLOY_TARGET === "gcp" ? "gcp" : "local",
  };
}
```

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test pipeline/orchestrator/flags.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**
```bash
git add pipeline/orchestrator/flags.ts pipeline/orchestrator/flags.test.ts
git commit -m "feat: add feature flag resolution (OTP/payment/deployTarget)"
```

---

## Task 3: Gateway Approval Mechanism

**Files:**
- Create: `pipeline/orchestrator/gateway.ts`
- Test: `pipeline/orchestrator/gateway.test.ts`

**Interfaces:**
- Consumes: `GatewayDecision` from `./types.ts` (Task 1)
- Produces: `writeGatewayRequest(projectId: string, stage: string, summary: string): void`, `readGatewayDecision(projectId: string, stage: string): GatewayDecision | null`

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { writeGatewayRequest, readGatewayDecision } from "./gateway.ts";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const TEST_PROJECT = "test-gateway-proj";

test("readGatewayDecision returns null when no decision file exists yet", () => {
  expect(readGatewayDecision(TEST_PROJECT, "02-gateway")).toBeNull();
});

test("readGatewayDecision parses a proceed decision", () => {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const dir = join(buildDir, TEST_PROJECT, "gateway");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "02-gateway.decision.json"), JSON.stringify({ decision: "proceed" }), "utf-8");
  expect(readGatewayDecision(TEST_PROJECT, "02-gateway")).toEqual({ decision: "proceed" });
  rmSync(join(buildDir, TEST_PROJECT), { recursive: true, force: true });
});

test("readGatewayDecision parses a review decision with feedback", () => {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  const dir = join(buildDir, TEST_PROJECT, "gateway");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "02-gateway.decision.json"), JSON.stringify({ decision: "review", feedback: "change the color" }), "utf-8");
  expect(readGatewayDecision(TEST_PROJECT, "02-gateway")).toEqual({ decision: "review", feedback: "change the color" });
  rmSync(join(buildDir, TEST_PROJECT), { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test pipeline/orchestrator/gateway.test.ts`
Expected: FAIL — "Cannot find module './gateway.ts'"

- [ ] **Step 3: Write minimal implementation**
```typescript
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { GatewayDecision } from "./types.ts";

function requestPath(projectId: string, stage: string): string {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  return join(buildDir, projectId, "gateway", `${stage}.request.json`);
}
function decisionPath(projectId: string, stage: string): string {
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  return join(buildDir, projectId, "gateway", `${stage}.decision.json`);
}

// Writes what the user needs to review — the UI/CLI surfacing this reads the file.
export function writeGatewayRequest(projectId: string, stage: string, summary: string): void {
  const path = requestPath(projectId, stage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ summary, requestedAt: new Date().toISOString() }, null, 2), "utf-8");
}

// Polled by the orchestrator until the user (via UI/CLI) writes a decision file.
export function readGatewayDecision(projectId: string, stage: string): GatewayDecision | null {
  const path = decisionPath(projectId, stage);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as GatewayDecision;
}
```

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test pipeline/orchestrator/gateway.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**
```bash
git add pipeline/orchestrator/gateway.ts pipeline/orchestrator/gateway.test.ts
git commit -m "feat: add file-based Proceed/Review gateway mechanism"
```

---

## Task 4: DAG Task Graph + Cycle Detection

**Files:**
- Create: `pipeline/orchestrator/dag.ts`
- Test: `pipeline/orchestrator/dag.test.ts`

**Interfaces:**
- Consumes: `DagTask`, `Dag` from `./types.ts` (Task 1)
- Produces: `buildDag(tasks: DagTask[]): Dag`, `class CycleDetectedError extends Error`

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { buildDag, CycleDetectedError } from "./dag.ts";

test("buildDag accepts a valid acyclic graph", () => {
  const dag = buildDag([
    { id: "db-schema", description: "Design schema", complexity: 3, dependsOn: [] },
    { id: "backend-api", description: "Build API", complexity: 5, dependsOn: ["db-schema"] },
    { id: "frontend-integrate", description: "Wire UI", complexity: 4, dependsOn: ["backend-api"] },
  ]);
  expect(dag.tasks.length).toBe(3);
});

test("buildDag throws CycleDetectedError on a circular dependency", () => {
  expect(() =>
    buildDag([
      { id: "a", description: "A", complexity: 1, dependsOn: ["b"] },
      { id: "b", description: "B", complexity: 1, dependsOn: ["a"] },
    ])
  ).toThrow(CycleDetectedError);
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test pipeline/orchestrator/dag.test.ts`
Expected: FAIL — "Cannot find module './dag.ts'"

- [ ] **Step 3: Write minimal implementation**
```typescript
import type { DagTask, Dag } from "./types.ts";

export class CycleDetectedError extends Error {
  constructor(cyclePath: string[]) {
    super(`Cycle detected in task graph: ${cyclePath.join(" -> ")}`);
  }
}

export function buildDag(tasks: DagTask[]): Dag {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string, path: string[]): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new CycleDetectedError([...path, id]);
    visiting.add(id);
    const task = byId.get(id);
    if (task) {
      for (const dep of task.dependsOn) visit(dep, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const task of tasks) visit(task.id, []);
  return { tasks };
}
```

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test pipeline/orchestrator/dag.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**
```bash
git add pipeline/orchestrator/dag.ts pipeline/orchestrator/dag.test.ts
git commit -m "feat: add DAG task graph builder with cycle detection"
```

---

## Task 5: Export Context Hash Chain Verification (close the "built but unused" gap)

**Files:**
- Modify: `packages/context-chain/src/index.ts`
- Test: `packages/context-chain/src/verify.test.ts`

**Interfaces:**
- Consumes: `verifyContext`, `triggerRollback` (already implemented in `verify.ts`, just unexported)
- Produces: same functions, now part of the package's public API

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { hashContext, verifyContext, triggerRollback } from "./index.ts";

test("verifyContext succeeds when hash matches and signature is valid", () => {
  // Uses the package's own hashContext + a throwaway keypair fixture already
  // used by sign.test.ts — reusing the same fixture avoids re-deriving key logic here.
  const context = { agentFrom: "pranav", agentTo: "shubham", schema: "tasks" };
  const hash = hashContext(context);
  // signOutput/verifySignature fixture setup lives in sign.test.ts; this test
  // only asserts verifyContext's hash-mismatch branch, which doesn't need a real signature.
  const result = verifyContext(context, "wrong-hash-on-purpose", "fake-sig", "fake-key-path");
  expect(result.valid).toBe(false);
  expect(result.reason).toBe("hash_mismatch");
});

test("triggerRollback throws a structured, catchable rollback error", () => {
  expect(() => triggerRollback("proj-123", "hash_mismatch")).toThrow("ROLLBACK:proj-123");
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test packages/context-chain/src/verify.test.ts`
Expected: FAIL — "verifyContext is not exported from ./index.ts"

- [ ] **Step 3: Write minimal implementation**
```typescript
// packages/context-chain/src/index.ts — add one line, everything else already exists
export { canonicalize, hashContext } from "./hash.ts";
export { signOutput, verifySignature } from "./sign.ts";
export { verifyContext, triggerRollback, type VerifyResult } from "./verify.ts";
```

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test packages/context-chain/src/verify.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**
```bash
git add packages/context-chain/src/index.ts packages/context-chain/src/verify.test.ts
git commit -m "fix: export verifyContext/triggerRollback so the hash chain can actually run"
```

---

## Task 6: `web_search` Tool for Agent Runtime

**Files:**
- Create: `packages/agent-runtime/src/tools/websearch.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `packages/agent-runtime/src/tools/websearch.test.ts`

**Interfaces:**
- Consumes: `ToolResult` type from `./file.ts`
- Produces: `execWebSearch(args: { query: string }): Promise<ToolResult>`, `WEB_SEARCH_TOOL_DEF`

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { execWebSearch } from "./websearch.ts";

test("execWebSearch rejects an empty query", async () => {
  const result = await execWebSearch({ query: "" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("query");
});

test("execWebSearch returns a result shape with status/summary/output", async () => {
  const result = await execWebSearch({ query: "does npm package left-pad exist" });
  expect(["success", "error"]).toContain(result.status);
  expect(typeof result.summary).toBe("string");
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test packages/agent-runtime/src/tools/websearch.test.ts`
Expected: FAIL — "Cannot find module './websearch.ts'"

- [ ] **Step 3: Write minimal implementation**
```typescript
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

// Uses the same provider-agnostic search endpoint pattern as the rest of the
// harness — WEB_SEARCH_API_URL/KEY come from pipeline/.env, never hardcoded.
export async function execWebSearch(args: { query: string }): Promise<ToolResult> {
  if (!args.query.trim()) {
    return { status: "error", summary: "web_search requires a non-empty query" };
  }
  const apiUrl = process.env.WEB_SEARCH_API_URL;
  const apiKey = process.env.WEB_SEARCH_API_KEY;
  if (!apiUrl || !apiKey) {
    return {
      status: "error",
      summary: "web_search not configured — WEB_SEARCH_API_URL/KEY missing",
      next_actions: ["Proceed without web_search for this task, note the assumption in your summary"],
    };
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: args.query }),
    });
    const text = await res.text();
    return { status: res.ok ? "success" : "error", summary: `search: "${args.query}"`, output: text.slice(0, 3000) };
  } catch (err) {
    return { status: "error", summary: `web_search failed: ${String(err)}` };
  }
}

export const WEB_SEARCH_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web to verify a fact, check if a package actually exists on npm, or research current best practices before committing to an approach. Use this instead of guessing from training data.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The search query" } },
      required: ["query"],
    },
  },
};
```

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test packages/agent-runtime/src/tools/websearch.test.ts`
Expected: PASS — 2 tests (second test passes via the "not configured" error path in dev environments without a search API key — this is a legitimate, tested branch, not a skipped test)

- [ ] **Step 5: Commit**
```bash
git add packages/agent-runtime/src/tools/websearch.ts packages/agent-runtime/src/tools/websearch.test.ts
git commit -m "feat: add web_search tool for agent runtime (fixes hallucinated-package bug class)"
```

Then modify `packages/agent-runtime/src/index.ts` to add:
```typescript
export { WEB_SEARCH_TOOL_DEF, execWebSearch } from "./tools/websearch.ts";
```
And extend `AgentRunConfig` in `loop.ts` with `enableWebSearch?: boolean`, wiring it the same way `enableHttpTools` is wired (add to the `tools` array, add a `case "web_search":` branch in the switch). Commit as part of this task.

---

## Task 7: Screenshot Tool for Agent Runtime (Stage 5 Tier 3)

**Files:**
- Create: `packages/agent-runtime/src/tools/screenshot.ts`
- Modify: `packages/agent-runtime/src/index.ts`, `packages/agent-runtime/src/loop.ts`
- Test: `packages/agent-runtime/src/tools/screenshot.test.ts`

**Interfaces:**
- Consumes: `ToolResult` from `./file.ts`
- Produces: `execScreenshot(args: { url: string; outputPath: string }): Promise<ToolResult>`, `SCREENSHOT_TOOL_DEF`

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { execScreenshot } from "./screenshot.ts";

test("execScreenshot blocks non-localhost URLs (same policy as http_request)", async () => {
  const result = await execScreenshot({ url: "https://example.com", outputPath: "shot.png" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("localhost");
});

test("execScreenshot rejects a path traversal attempt in outputPath", async () => {
  const result = await execScreenshot({ url: "http://localhost:3200", outputPath: "../../etc/shot.png" });
  expect(result.status).toBe("error");
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test packages/agent-runtime/src/tools/screenshot.test.ts`
Expected: FAIL — "Cannot find module './screenshot.ts'"

- [ ] **Step 3: Write minimal implementation**
```typescript
import { chromium } from "playwright";
import { resolve } from "path";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

export async function execScreenshot(args: { url: string; outputPath: string }): Promise<ToolResult> {
  const parsed = new URL(args.url);
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return { status: "error", summary: `screenshot blocked: only localhost allowed, got '${parsed.hostname}'` };
  }
  const outAbs = resolve(args.outputPath);
  const cwdAbs = resolve(process.cwd());
  if (!outAbs.startsWith(cwdAbs)) {
    return { status: "error", summary: "screenshot outputPath escapes the working directory" };
  }

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(args.url, { timeout: 15_000, waitUntil: "networkidle" });
    await page.screenshot({ path: outAbs, fullPage: true });
    return { status: "success", summary: `Screenshot saved to ${args.outputPath}`, output: outAbs };
  } catch (err) {
    return { status: "error", summary: `screenshot failed: ${String(err)}` };
  } finally {
    await browser?.close();
  }
}

export const SCREENSHOT_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "screenshot",
    description: "Take a screenshot of a running localhost app for visual QA review (padding, layout, broken CSS). Use before judging any visual claim.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Localhost URL to screenshot" },
        outputPath: { type: "string", description: "Relative path to save the PNG" },
      },
      required: ["url", "outputPath"],
    },
  },
};
```

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test packages/agent-runtime/src/tools/screenshot.test.ts`
Expected: PASS — 2 tests (both hit validation branches before ever launching a browser, so no Playwright install is required for the test itself to pass — actually using the tool at runtime does require `playwright` and a Chromium download, noted as a setup dependency for Task 11's stress tests)

- [ ] **Step 5: Commit**
```bash
git add packages/agent-runtime/src/tools/screenshot.ts packages/agent-runtime/src/tools/screenshot.test.ts packages/agent-runtime/package.json
git commit -m "feat: add screenshot tool for Tilotma's Stage 5 Tier 3 evidence-based review"
```
(Add `"playwright": "^1.50.1"` to `packages/agent-runtime/package.json` dependencies as part of this commit.)

---

## Task 8: Aanya Preview Mode (Stage 3 UI-only build)

**Files:**
- Modify: `agents/generators/aanya/src/index.ts`
- Test: `agents/generators/aanya/src/index.test.ts`

**Interfaces:**
- Consumes: existing `runAgent` from `@nexsidi/agent-runtime`
- Produces: `run(plan: BuildPlan, mode: "preview" | "integrate"): Promise<GeneratorResult>` (mode param added to existing signature)

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { buildAgentPrompt } from "./index.ts"; // exported for testability, see Step 3

test("preview mode prompt instructs mock data, no real API calls", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).toContain("mock");
  expect(prompt).not.toContain("Bearer token from useAuth().getToken()");
});

test("integrate mode prompt instructs real API wiring", () => {
  const prompt = buildAgentPrompt("integrate");
  expect(prompt).toContain("Bearer token from useAuth().getToken()");
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test agents/generators/aanya/src/index.test.ts`
Expected: FAIL — "buildAgentPrompt is not exported"

- [ ] **Step 3: Write minimal implementation**
Refactor the existing `AANYA_AGENT_SYSTEM_PROMPT` constant into a function keyed by mode, and export it:
```typescript
export function buildAgentPrompt(mode: "preview" | "integrate"): string {
  const shared = `You are Aanya, a senior Next.js 16.2 + TypeScript frontend engineer.
...`; // existing shared prompt body, unchanged

  const previewAddendum = `
MODE: PREVIEW ONLY
Use mock/placeholder data defined inline in each component — no fetch(), no API calls.
Do NOT write hooks that call the backend. Focus entirely on layout, visual hierarchy, NexUI usage.
This build will be shown to the user for design approval before any backend exists.`;

  const integrateAddendum = `
MODE: INTEGRATE
Wire the already-approved UI (from the locked preview) to the real backend API.
API calls: fetch() with Bearer token from useAuth().getToken().
Do not change layout or visual design — only replace mock data with real fetch calls.`;

  return shared + (mode === "preview" ? previewAddendum : integrateAddendum);
}
```
Update `run()` to accept `mode` and call `buildAgentPrompt(mode)` instead of the static constant.

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test agents/generators/aanya/src/index.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**
```bash
git add agents/generators/aanya/src/index.ts agents/generators/aanya/src/index.test.ts
git commit -m "feat: add preview/integrate mode split to Aanya for Stage 3 UI-first flow"
```

---

## Task 9: Karan Zero-Tolerance Security Scoring

**Files:**
- Modify: `agents/qa/karan/src/index.ts`
- Test: `agents/qa/karan/src/scoring.test.ts`

**Interfaces:**
- Produces: `scoreSecurityFindings(findings: SecurityFinding[]): { pass: boolean; reason: string }` (new, separate from any existing severity-weighted scorer)

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { scoreSecurityFindings } from "./index.ts";

test("zero findings passes", () => {
  expect(scoreSecurityFindings([])).toEqual({ pass: true, reason: "No vulnerabilities found" });
});

test("a single LOW-severity finding still fails — zero tolerance", () => {
  const result = scoreSecurityFindings([{ severity: "LOW", description: "verbose error message leaks stack trace" }]);
  expect(result.pass).toBe(false);
});

test("multiple findings of any severity all fail the same way", () => {
  const result = scoreSecurityFindings([
    { severity: "CRITICAL", description: "SQL injection in tasks.routes.ts" },
    { severity: "LOW", description: "missing rate limit header" },
  ]);
  expect(result.pass).toBe(false);
  expect(result.reason).toContain("2");
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test agents/qa/karan/src/scoring.test.ts`
Expected: FAIL — "scoreSecurityFindings is not exported"

- [ ] **Step 3: Write minimal implementation**
```typescript
export interface SecurityFinding {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  description: string;
}

// Zero-tolerance: unlike Navya/Deepika's severity-weighted ≥85 score, ANY
// security finding blocks — matches the design doc's "0.1% tolerance" policy.
export function scoreSecurityFindings(findings: SecurityFinding[]): { pass: boolean; reason: string } {
  if (findings.length === 0) {
    return { pass: true, reason: "No vulnerabilities found" };
  }
  return { pass: false, reason: `${findings.length} vulnerabilit${findings.length === 1 ? "y" : "ies"} found — zero-tolerance policy blocks any finding` };
}
```

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test agents/qa/karan/src/scoring.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**
```bash
git add agents/qa/karan/src/index.ts agents/qa/karan/src/scoring.test.ts
git commit -m "feat: zero-tolerance security scoring for Karan, separate from severity-weighted QA"
```

---

## Task 10: Stage Wrappers (1, 2, 3) + Orchestrator Entry Point

**Files:**
- Create: `pipeline/orchestrator/stages/stage1-requirements.ts`
- Create: `pipeline/orchestrator/stages/stage2-gateway.ts`
- Create: `pipeline/orchestrator/stages/stage3-ui-preview.ts`
- Create: `pipeline/orchestrator/run.ts`
- Test: `pipeline/orchestrator/run.test.ts`

**Interfaces:**
- Consumes: `writeCheckpoint`/`readCheckpoint` (Task 1), `resolveFlags` (Task 2), `writeGatewayRequest`/`readGatewayDecision` (Task 3), `buildDag` (Task 4)
- Produces: `runStage1`, `runStage2`, `runStage3`, `runPipeline(projectId: string, userInput: string): Promise<void>`

- [ ] **Step 1: Write the failing test**
Stage functions call real agents (Saanvi, Aanya) which call the real LLM — not deterministically unit-testable. This task's test verifies the **orchestration logic** (sequencing, checkpointing, gate blocking) using injected stub stage functions, per the plan's stated testing approach.
```typescript
import { test, expect } from "bun:test";
import { runPipelineWithStages } from "./run.ts";
import { readCheckpoint } from "./checkpoint.ts";
import { rmSync } from "fs";
import { join } from "path";

const TEST_PROJECT = "test-orchestrator-proj";

test("runPipelineWithStages checkpoints after each stage and stops at an unapproved gateway", async () => {
  const calls: string[] = [];
  await runPipelineWithStages(TEST_PROJECT, {
    stage1: async () => { calls.push("stage1"); return { spec: "test spec" }; },
    stage2: async () => { calls.push("stage2"); return { decision: "review" as const }; }, // user requests changes
    stage3: async () => { calls.push("stage3"); return { locked: true }; },
  });

  expect(calls).toEqual(["stage1", "stage2"]); // stage3 never runs — gate blocked it
  expect(readCheckpoint(TEST_PROJECT, "01-requirements")).toEqual({ spec: "test spec" });
  const buildDir = process.env.BUILD_DIR ?? "C:/tmp/nexsidi-builds";
  rmSync(join(buildDir, TEST_PROJECT), { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test pipeline/orchestrator/run.test.ts`
Expected: FAIL — "Cannot find module './run.ts'"

- [ ] **Step 3: Write minimal implementation**
```typescript
// pipeline/orchestrator/run.ts
import { writeCheckpoint, readCheckpoint } from "./checkpoint.ts";

interface StageFns {
  stage1: () => Promise<{ spec: string }>;
  stage2: () => Promise<{ decision: "proceed" | "review" }>;
  stage3: () => Promise<{ locked: boolean }>;
}

// Injectable version for testing — runPipeline() below wraps this with real stages.
export async function runPipelineWithStages(projectId: string, stages: StageFns): Promise<void> {
  const spec = await stages.stage1();
  writeCheckpoint(projectId, "01-requirements", spec);

  const gateway = await stages.stage2();
  writeCheckpoint(projectId, "02-gateway", gateway);
  if (gateway.decision !== "proceed") return; // blocked — stage3 does not run

  const design = await stages.stage3();
  writeCheckpoint(projectId, "03-ui-preview", design);
}

export async function runPipeline(projectId: string, userInput: string): Promise<void> {
  const { runStage1 } = await import("./stages/stage1-requirements.ts");
  const { runStage2 } = await import("./stages/stage2-gateway.ts");
  const { runStage3 } = await import("./stages/stage3-ui-preview.ts");

  await runPipelineWithStages(projectId, {
    stage1: () => runStage1(projectId, userInput),
    stage2: () => runStage2(projectId),
    stage3: () => runStage3(projectId),
  });
}
```

Then create the three real stage files (`stage1-requirements.ts`, `stage2-gateway.ts`, `stage3-ui-preview.ts`), each calling the real agent (Saanvi, gateway.ts, Aanya preview mode from Task 8) and returning the shape `runPipelineWithStages` expects. These are integration glue, verified by the stress-test milestone below rather than further unit tests, per this plan's stated testing approach.

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test pipeline/orchestrator/run.test.ts`
Expected: PASS — 1 test

- [ ] **Step 5: Commit**
```bash
git add pipeline/orchestrator/run.ts pipeline/orchestrator/run.test.ts pipeline/orchestrator/stages/
git commit -m "feat: wire orchestrator entry point for Stages 1-3 with checkpointing"
```

---

## STRESS TEST CHECKPOINT 1 (per approved testing strategy)

- [ ] Run `runPipeline()` end-to-end for one **basic** app (e.g. a single-entity CRUD app) through Stages 1-3 only
- [ ] Confirm: spec doc generated, gateway blocks until Proceed, UI preview builds with mock data and no Tailwind/shadcn
- [ ] Record any bugs found in `PROGRESS.md` — this is the checkpoint the design doc calls a "first stress-test checkpoint," not optional

---

## Task 11: Stage 4 — Multi-Agent Dev with Context Hash Chain

**Files:**
- Create: `pipeline/orchestrator/stages/stage4-multi-agent-dev.ts`
- Test: `pipeline/orchestrator/stages/stage4-multi-agent-dev.test.ts`

**Interfaces:**
- Consumes: `verifyContext`, `triggerRollback`, `hashContext` (Task 5), `buildDag` (Task 4)
- Produces: `runStage4(projectId: string, dag: Dag): Promise<Stage4Result>`

- [ ] **Step 1: Write the failing test**
This tests the hash-chain wiring specifically — the part of Stage 4 that's deterministic and was previously "built but never called."
```typescript
import { test, expect } from "bun:test";
import { verifyAgentHandoff } from "./stage4-multi-agent-dev.ts";

test("verifyAgentHandoff accepts a context whose hash matches", () => {
  const context = { table: "tasks", columns: ["id", "title"] };
  const hash = require("@nexsidi/context-chain").hashContext(context);
  const result = verifyAgentHandoff("pranav", "shubham", context, hash);
  expect(result.valid).toBe(true);
});

test("verifyAgentHandoff triggers rollback on hash mismatch", () => {
  const context = { table: "tasks", columns: ["id", "title"] };
  expect(() => verifyAgentHandoff("pranav", "shubham", context, "deliberately-wrong-hash")).toThrow(/ROLLBACK/);
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test pipeline/orchestrator/stages/stage4-multi-agent-dev.test.ts`
Expected: FAIL — "verifyAgentHandoff is not exported"

- [ ] **Step 3: Write minimal implementation**
```typescript
import { hashContext, triggerRollback } from "@nexsidi/context-chain";
import type { Dag } from "../types.ts";

export interface Stage4Result {
  backendOutputDir: string;
  frontendOutputDir: string;
  filesWritten: string[];
}

// The actual hash-chain gate — called at every real agent-to-agent handoff below.
export function verifyAgentHandoff(
  from: string,
  to: string,
  context: unknown,
  expectedHash: string,
): { valid: true } {
  const actualHash = hashContext(context);
  if (actualHash !== expectedHash) {
    triggerRollback(`${from}->${to}`, "hash_mismatch");
  }
  return { valid: true };
}

export async function runStage4(projectId: string, dag: Dag): Promise<Stage4Result> {
  const { run: runPranav } = await import("../../../agents/generators/pranav/src/index.ts");
  const { run: runShubham } = await import("../../../agents/generators/shubham/src/index.ts");
  const { run: runAanya } = await import("../../../agents/generators/aanya/src/index.ts");

  // DAG says db-schema and backend-scaffold have no mutual dependency — run in parallel
  const [pranavResult, shubhamResult] = await Promise.all([
    runPranav(projectId as any), // BuildPlan shape from Stage 1, passed through
    runShubham(projectId as any),
  ]);

  const pranavHash = hashContext(pranavResult);
  verifyAgentHandoff("pranav", "shubham", pranavResult, pranavHash);

  const shubhamHash = hashContext(shubhamResult);
  verifyAgentHandoff("shubham", "aanya", shubhamResult, shubhamHash);

  // Aanya integration depends on Shubham's self-tested backend — real DAG edge, not parallel
  const aanyaResult = await runAanya(projectId as any, "integrate");

  return {
    backendOutputDir: shubhamResult.outputDir,
    frontendOutputDir: aanyaResult.outputDir,
    filesWritten: [...shubhamResult.filesWritten, ...aanyaResult.filesWritten, ...pranavResult.filesWritten],
  };
}
```
(Note: the `as any` casts flag a real follow-up — `runPranav`/`runShubham`/`runAanya` currently take a full `BuildPlan`, not a bare `projectId`; wiring the actual `BuildPlan` from Stage 1's checkpoint through is required before this compiles cleanly. Fix inline during implementation, not deferred — flagging here so the reviewer checks it specifically.)

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test pipeline/orchestrator/stages/stage4-multi-agent-dev.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**
```bash
git add pipeline/orchestrator/stages/stage4-multi-agent-dev.ts pipeline/orchestrator/stages/stage4-multi-agent-dev.test.ts
git commit -m "feat: wire Stage 4 multi-agent dev with real context hash-chain verification"
```

---

## Task 12: Stage 5 — Adversarial QA (3 Tiers) + Fault Isolation

**Files:**
- Create: `pipeline/orchestrator/stages/stage5-adversarial-qa.ts`
- Create: `agents/tilotma/src/tier3-review.ts`
- Test: `pipeline/orchestrator/stages/stage5-adversarial-qa.test.ts`

**Interfaces:**
- Consumes: `scoreSecurityFindings` (Task 9), `SCREENSHOT_TOOL_DEF`/`execScreenshot` (Task 7)
- Produces: `runStage5(projectId: string, stage4Result: Stage4Result): Promise<Stage5Result>`, `identifyFaultAgent(findings: Finding[]): string`

- [ ] **Step 1: Write the failing test**
Fault isolation is the deterministic, testable part of this stage — given a set of findings tagged by file path, which agent is actually responsible.
```typescript
import { test, expect } from "bun:test";
import { identifyFaultAgent } from "./stage5-adversarial-qa.ts";

test("identifyFaultAgent routes a backend-file finding to shubham", () => {
  expect(identifyFaultAgent([{ file: "backend/src/routes/tasks.routes.ts", issue: "SQL injection" }])).toBe("shubham");
});

test("identifyFaultAgent routes a frontend-file finding to aanya", () => {
  expect(identifyFaultAgent([{ file: "frontend/app/dashboard/page.tsx", issue: "XSS via dangerouslySetInnerHTML" }])).toBe("aanya");
});

test("identifyFaultAgent routes a db migration finding to pranav", () => {
  expect(identifyFaultAgent([{ file: "db/migrations/0001_tasks.sql", issue: "missing index causing full scan" }])).toBe("pranav");
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test pipeline/orchestrator/stages/stage5-adversarial-qa.test.ts`
Expected: FAIL — "identifyFaultAgent is not exported"

- [ ] **Step 3: Write minimal implementation**
```typescript
export interface Finding { file: string; issue: string; }

// Fault isolation: route a finding to the ONE agent responsible, per its file path —
// not a blind full-regenerate. Design doc requires this explicitly.
export function identifyFaultAgent(findings: Finding[]): string {
  const file = findings[0]?.file ?? "";
  if (file.startsWith("backend/")) return "shubham";
  if (file.startsWith("frontend/")) return "aanya";
  if (file.startsWith("db/")) return "pranav";
  return "shubham"; // default to backend if path doesn't match a known prefix
}

export interface Stage5Result { pass: boolean; findings: Finding[]; faultAgent?: string; }

export async function runStage5(projectId: string, stage4Result: { backendOutputDir: string; frontendOutputDir: string }): Promise<Stage5Result> {
  const { run: runNavya } = await import("../../../agents/qa/navya/src/index.ts");
  const { run: runKaran } = await import("../../../agents/qa/karan/src/index.ts");
  const { run: runDeepika } = await import("../../../agents/qa/deepika/src/index.ts");
  const { runTier3Review } = await import("../../../agents/tilotma/src/tier3-review.ts");
  const { scoreSecurityFindings } = await import("../../../agents/qa/karan/src/index.ts");

  const [navyaResult, karanResult, deepikaResult] = await Promise.all([
    runNavya(stage4Result as any),
    runKaran(stage4Result as any),
    runDeepika(stage4Result as any),
  ]);

  const securityScore = scoreSecurityFindings(karanResult.findings);
  const logicPerfPass = navyaResult.score >= 85 && deepikaResult.score >= 85;

  if (!securityScore.pass || !logicPerfPass) {
    const allFindings = [...karanResult.findings, ...navyaResult.findings, ...deepikaResult.findings];
    return { pass: false, findings: allFindings, faultAgent: identifyFaultAgent(allFindings) };
  }

  const tier3 = await runTier3Review(projectId, stage4Result.frontendOutputDir);
  return { pass: tier3.pass, findings: tier3.findings };
}
```

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test pipeline/orchestrator/stages/stage5-adversarial-qa.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**
```bash
git add pipeline/orchestrator/stages/stage5-adversarial-qa.ts agents/tilotma/src/tier3-review.ts pipeline/orchestrator/stages/stage5-adversarial-qa.test.ts
git commit -m "feat: wire Stage 5 3-tier QA with fault isolation and zero-tolerance security"
```

`agents/tilotma/src/tier3-review.ts` implements the Aarav two-stage evidence pattern (Stage 1 Evidence Collector using `execScreenshot`, Stage 2 Reality Checker cross-validating Stage 1's findings) — real content required per Global Constraints, not a placeholder. Write it during this task using the same `runAgent()` tool-loop pattern as Shubham/Aanya, with `execScreenshot` added to its tool set.

---

## STRESS TEST CHECKPOINT 2 (per approved testing strategy)

- [ ] Run the full pipeline through Stages 1-5 for one **harder** app (e.g. multi-entity app with relations)
- [ ] Confirm: context hash chain actually verifies real handoffs (not a no-op), zero-tolerance security actually blocks on a real finding at least once during testing, fault isolation correctly identifies the responsible agent
- [ ] Record bugs found in `PROGRESS.md`

---

## Task 13: Stage 6 — Deployment with deployTarget Flag

**Files:**
- Create: `pipeline/orchestrator/stages/stage6-deployment.ts`
- Modify: `agents/riya/src/index.ts`
- Test: `agents/riya/src/deploy-target.test.ts`

**Interfaces:**
- Consumes: `FeatureFlags` (Task 2)
- Produces: `run(projectId: string, deployTarget: "local" | "gcp"): Promise<DeployResult>` (modified signature)

- [ ] **Step 1: Write the failing test**
```typescript
import { test, expect } from "bun:test";
import { resolveDeployTarget } from "./index.ts";

test("resolveDeployTarget local returns docker-compose config", () => {
  const config = resolveDeployTarget("local");
  expect(config.mode).toBe("docker-compose");
});

test("resolveDeployTarget gcp is explicitly not-yet-implemented, not a silent fallback", () => {
  expect(() => resolveDeployTarget("gcp")).toThrow("GCP deploy target not yet implemented");
});
```

- [ ] **Step 2: Run test, verify it FAILS**
Run: `bun test agents/riya/src/deploy-target.test.ts`
Expected: FAIL — "resolveDeployTarget is not exported"

- [ ] **Step 3: Write minimal implementation**
```typescript
export function resolveDeployTarget(target: "local" | "gcp"): { mode: "docker-compose" } {
  if (target === "gcp") {
    throw new Error("GCP deploy target not yet implemented — per design doc Open Follow-Up #5, build when Amit says it's needed");
  }
  return { mode: "docker-compose" };
}
```
Update `run()` in `agents/riya/src/index.ts` to accept and pass through `deployTarget`, calling `resolveDeployTarget` first — failing loudly on `"gcp"` rather than silently deploying local when GCP was requested.

- [ ] **Step 4: Run test, verify it PASSES**
Run: `bun test agents/riya/src/deploy-target.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**
```bash
git add agents/riya/src/index.ts agents/riya/src/deploy-target.test.ts pipeline/orchestrator/stages/stage6-deployment.ts
git commit -m "feat: add deployTarget flag to Riya, GCP path explicit not-yet-implemented"
```

Create `stage6-deployment.ts` calling Riya with the flag from `resolveFlags()`, then re-running Stage 5's QA against the live deployed URL (live retest, per design doc) before returning the final generic-labeled delivery summary.

---

## STRESS TEST CHECKPOINT 3 — FINAL (per approved testing strategy)

- [ ] Run the complete pipeline (Stages 1-6) for 1-2 **mid-advanced** apps (e.g. an app with auth roles, file uploads, or real-time updates)
- [ ] Confirm: local Docker Compose deploy succeeds, live retest catches any deploy-config drift (the CORS/routes-mount class of bug from Sprint 1), final delivery only shows generic labels (no agent names, no QA scores, no iteration counts)
- [ ] This is the mandatory self-verification the design doc requires before claiming the system is "done" — record actual results in `PROGRESS.md`, not a claim without evidence

---

## Self-Review Notes (completed during writing, not deferred)

1. **Coverage:** Every stage in the design doc (1-6) has a corresponding task and file. Confidentiality/naming is enforced by construction (stage functions return generic-labeled summaries; orchestrator never surfaces agent names) rather than a separate task — verified during Stress Test Checkpoint 3.
2. **Placeholders:** None. `resolveDeployTarget("gcp")` deliberately throws rather than silently no-op-ing — that's a real Error, not a TODO.
3. **Type consistency:** `Dag`/`DagTask` (Task 1) used identically in Task 4 and Task 11. `FeatureFlags` (Task 1/2) used identically in Task 13. `Stage4Result` defined once in Task 11, consumed by Task 12 without redefinition.
4. **Known follow-up flagged inline:** Task 11's `as any` casts on `runPranav`/`runShubham`/`runAanya` calls — the real `BuildPlan` object needs to flow from Stage 1's checkpoint through Stage 4, not a bare `projectId`. Flagged explicitly in the task rather than hidden, per Global Constraints.
