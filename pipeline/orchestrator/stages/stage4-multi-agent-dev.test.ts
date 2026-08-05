import { afterAll, beforeAll, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashContext, signOutput } from "@nexsidi/context-chain";
import { getProjectKeyPair, identifyFaultAgent, identifyFaultAgents, groupFindingsByAgent, agentForFile, verifyAgentHandoff, generationDispatchStaggerMs } from "./stage4-multi-agent-dev.ts";

// ── generationDispatchStaggerMs (avoids bursting the shared Gemini token bucket) ──
test("generationDispatchStaggerMs defaults to 4000ms when unset", () => {
  delete process.env.GENERATION_DISPATCH_STAGGER_MS;
  expect(generationDispatchStaggerMs()).toBe(4000);
});

test("generationDispatchStaggerMs honors a GENERATION_DISPATCH_STAGGER_MS override, including 0", () => {
  process.env.GENERATION_DISPATCH_STAGGER_MS = "2000";
  expect(generationDispatchStaggerMs()).toBe(2000);
  process.env.GENERATION_DISPATCH_STAGGER_MS = "0";
  expect(generationDispatchStaggerMs()).toBe(0);
  delete process.env.GENERATION_DISPATCH_STAGGER_MS;
});

// ── getProjectKeyPair path-traversal guard (final-whole-branch-review.md F5) ──
test("getProjectKeyPair throws on a path-traversal projectId instead of writing keys outside BUILD_DIR", () => {
  expect(() => getProjectKeyPair("../../escaped")).toThrow(/Invalid projectId/);
});

test("getProjectKeyPair throws on a projectId containing a path separator", () => {
  expect(() => getProjectKeyPair("some/nested/id")).toThrow(/Invalid projectId/);
});

// Only the two deterministic parts of Stage 4 are unit-tested here — real
// agent calls (Pranav/Shubham/Aanya's run()) hit live LLMs and aren't
// unit-testable, per the plan's stated testing philosophy.

// ── identifyFaultAgent ───────────────────────────────────────────────────────
test("identifyFaultAgent routes a backend-file finding to shubham", () => {
  expect(
    identifyFaultAgent([{ file: "backend/src/routes/tasks.routes.ts", issue: "SQL injection" }]),
  ).toBe("shubham");
});

test("identifyFaultAgent routes a frontend-file finding to aanya", () => {
  expect(
    identifyFaultAgent([
      { file: "frontend/app/dashboard/page.tsx", issue: "XSS via dangerouslySetInnerHTML" },
    ]),
  ).toBe("aanya");
});

test("identifyFaultAgent routes a db migration finding to pranav", () => {
  expect(
    identifyFaultAgent([
      { file: "db/migrations/0001_tasks.sql", issue: "missing index causing full scan" },
    ]),
  ).toBe("pranav");
});

test("identifyFaultAgent defaults to shubham for an unrecognized path prefix", () => {
  expect(identifyFaultAgent([{ file: "docs/README.md", issue: "typo" }])).toBe("shubham");
});

// 2026-07-28 (live, complex1): real bug found live — a generated project's
// schema file physically lives at "backend/init.sql" (inside the backend
// output dir), not under a top-level "db/" prefix. The old backend/-prefix
// check routed it to shubham, who is instructed to never touch schema files
// — the same misrouted finding recurred every QA round with no way to ever
// get fixed. See agentForFile's header comment for the full root cause.
test("identifyFaultAgent routes a schema file living under backend/ (init.sql) to pranav, not shubham", () => {
  expect(
    identifyFaultAgent([{ file: "backend/init.sql", issue: "missing index on foreign key" }]),
  ).toBe("pranav");
});

test("agentForFile routes backend/schema.ts and backend/drizzle.config.ts to pranav", () => {
  expect(agentForFile("backend/schema.ts")).toBe("pranav");
  expect(agentForFile("backend/drizzle.config.ts")).toBe("pranav");
  expect(agentForFile("backend/db/migrations/0002_add_index.sql")).toBe("pranav");
});

test("agentForFile keeps a frontend file named schema.ts routed to aanya, not pranav", () => {
  // frontend/ must win over the schema-filename pattern — a Zod validation
  // schema file is not a database schema file just because it shares a name.
  expect(agentForFile("frontend/lib/schema.ts")).toBe("aanya");
});

test("agentForFile still routes ordinary backend application code to shubham", () => {
  expect(agentForFile("backend/src/controllers/tasks.ts")).toBe("shubham");
});

// identifyFaultAgents (plural) - real 2026-07-06 stress-test bug: the QA fix
// loop (stage5-qa-fix-loop.ts) used identifyFaultAgent's SINGLE result to
// decide which one agent to fix per round. A real run had findings spanning
// BOTH backend/ and frontend/ files in the same QA pass - since findings[0]
// was a backend/ file, the loop fixed Shubham every round and NEVER touched
// Aanya's frontend XSS finding, no matter how many retries ran. This returns
// the FULL set of implicated agents so the fix loop can route findings to
// every agent that actually has findings in a single round, not just the first.
test("identifyFaultAgents returns every agent with at least one finding, not just the first", () => {
  const agents = identifyFaultAgents([
    { file: "backend/src/index.ts", issue: "missing CSRF protection" },
    { file: "frontend/components/TaskForm.tsx", issue: "missing input sanitization" },
  ]);
  expect([...agents].sort()).toEqual(["aanya", "shubham"]);
});

test("identifyFaultAgents returns a single-element set when all findings are in one agent's files", () => {
  const agents = identifyFaultAgents([
    { file: "backend/src/index.ts", issue: "missing CSRF protection" },
    { file: "backend/src/controllers/tasks.ts", issue: "SQL injection risk" },
  ]);
  expect([...agents]).toEqual(["shubham"]);
});

test("identifyFaultAgents includes pranav for db/ findings alongside other agents in the same round", () => {
  const agents = identifyFaultAgents([
    { file: "backend/src/index.ts", issue: "missing CSRF protection" },
    { file: "db/migrations/0001_tasks.sql", issue: "missing index" },
  ]);
  expect([...agents].sort()).toEqual(["pranav", "shubham"]);
});

test("identifyFaultAgents defaults an unrecognized path prefix to shubham, same as identifyFaultAgent", () => {
  const agents = identifyFaultAgents([{ file: "docs/README.md", issue: "typo" }]);
  expect([...agents]).toEqual(["shubham"]);
});

// groupFindingsByAgent - the fix loop needs each agent's OWN subset of
// findings (not just which agents are implicated) so fixShubham only
// receives backend findings and fixAanya only receives frontend findings.
test("groupFindingsByAgent partitions mixed backend/frontend findings into separate per-agent lists", () => {
  const groups = groupFindingsByAgent([
    { file: "backend/src/index.ts", issue: "missing CSRF protection" },
    { file: "frontend/components/TaskForm.tsx", issue: "missing input sanitization" },
    { file: "backend/src/controllers/tasks.ts", issue: "SQL injection risk" },
  ]);
  expect(groups.get("shubham")).toEqual([
    { file: "backend/src/index.ts", issue: "missing CSRF protection" },
    { file: "backend/src/controllers/tasks.ts", issue: "SQL injection risk" },
  ]);
  expect(groups.get("aanya")).toEqual([
    { file: "frontend/components/TaskForm.tsx", issue: "missing input sanitization" },
  ]);
  expect(groups.has("pranav")).toBe(false);
});

// ── verifyAgentHandoff — real signature + hash chain (same keypair pattern as
// packages/context-chain/src/verify.test.ts) ──────────────────────────────────
let tmpDir: string;
let privateKeyPath: string;
let publicKeyPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "stage4-test-"));
  privateKeyPath = join(tmpDir, "private.pem");
  publicKeyPath = join(tmpDir, "public.pem");

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  writeFileSync(privateKeyPath, privateKey);
  writeFileSync(publicKeyPath, publicKey);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("verifyAgentHandoff accepts a genuinely signed and hashed context", () => {
  const context = { table: "tasks", columns: ["id", "title"] };
  const hash = hashContext(context);
  const signature = signOutput(context, privateKeyPath);

  const result = verifyAgentHandoff("pranav", "shubham", context, hash, signature, publicKeyPath);
  expect(result).toEqual({ valid: true });
});

test("verifyAgentHandoff triggers rollback when the context has been tampered with (hash mismatch)", () => {
  const original = { table: "tasks", columns: ["id", "title"] };
  const hash = hashContext(original);
  const signature = signOutput(original, privateKeyPath);

  // Simulate tampering after signing/hashing but before verification.
  const tampered = { table: "tasks", columns: ["id", "title", "secret_column"] };

  expect(() =>
    verifyAgentHandoff("pranav", "shubham", tampered, hash, signature, publicKeyPath),
  ).toThrow(/ROLLBACK:pranav->shubham/);
});

test("verifyAgentHandoff triggers rollback when the signature doesn't verify", () => {
  const context = { table: "tasks", columns: ["id", "title"] };
  const hash = hashContext(context);
  // Well-formed signature, but signed over different data.
  const wrongSignature = signOutput({ table: "someone_else" }, privateKeyPath);

  expect(() =>
    verifyAgentHandoff("pranav", "shubham", context, hash, wrongSignature, publicKeyPath),
  ).toThrow(/ROLLBACK:pranav->shubham/);
});

test("verifyAgentHandoff triggers rollback on a deliberately wrong hash", () => {
  const context = { table: "tasks", columns: ["id", "title"] };
  const signature = signOutput(context, privateKeyPath);

  expect(() =>
    verifyAgentHandoff(
      "pranav",
      "shubham",
      context,
      "deliberately-wrong-hash",
      signature,
      publicKeyPath,
    ),
  ).toThrow(/ROLLBACK/);
});
