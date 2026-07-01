import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { hashContext, signOutput, verifyContext, triggerRollback } from "./index.ts";

let tmpDir: string;
let privateKeyPath: string;
let publicKeyPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "context-chain-test-"));
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

test("verifyContext fails with hash_mismatch when the hash doesn't match", () => {
  const context = { agentFrom: "pranav", agentTo: "shubham", schema: "tasks" };
  const result = verifyContext(context, "wrong-hash-on-purpose", "fake-sig", "fake-key-path");
  expect(result.valid).toBe(false);
  expect(result.reason).toBe("hash_mismatch");
});

test("verifyContext succeeds when hash matches and signature is valid", () => {
  const context = { agentFrom: "pranav", agentTo: "shubham", schema: "tasks" };
  const hash = hashContext(context);
  const signature = signOutput(context, privateKeyPath);
  const result = verifyContext(context, hash, signature, publicKeyPath);
  expect(result).toEqual({ valid: true });
});

test("verifyContext fails with signature_invalid when signature doesn't verify", () => {
  const context = { agentFrom: "pranav", agentTo: "shubham", schema: "tasks" };
  const hash = hashContext(context);
  // Well-formed hex signature (same shape a real one would have) but signed over
  // different data, so it is well-formed yet does not verify against `context`.
  const wrongSignature = signOutput({ agentFrom: "someone", agentTo: "else" }, privateKeyPath);
  const result = verifyContext(context, hash, wrongSignature, publicKeyPath);
  expect(result).toEqual({ valid: false, reason: "signature_invalid" });
});

test("triggerRollback throws a structured, catchable rollback error", () => {
  expect(() => triggerRollback("proj-123", "hash_mismatch")).toThrow("ROLLBACK:proj-123");
});
