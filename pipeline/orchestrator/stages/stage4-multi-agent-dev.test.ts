import { afterAll, beforeAll, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashContext, signOutput } from "@nexsidi/context-chain";
import { identifyFaultAgent, verifyAgentHandoff } from "./stage4-multi-agent-dev.ts";

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
