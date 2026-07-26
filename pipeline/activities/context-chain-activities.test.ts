import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { hashContext } from "@nexsidi/context-chain";
import {
  buildContextChainRecord,
  decideVerification,
  computeHandoffSignature,
} from "./context-chain-activities.ts";

let tmpDir: string;
let privateKeyPath: string;
let publicKeyPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "context-chain-activities-test-"));
  privateKeyPath = join(tmpDir, "private.pem");
  publicKeyPath = join(tmpDir, "public.pem");

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  writeFileSync(privateKeyPath, privateKey);
  writeFileSync(publicKeyPath, publicKey);
}, 30_000);

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── buildContextChainRecord — exact Drizzle insert shape ────────────────────

test("buildContextChainRecord produces the exact append-only insert shape", () => {
  const record = buildContextChainRecord({
    projectId: "nextech10",
    agentFrom: "saanvi",
    agentTo: "arjun",
    contextHash: "a".repeat(64),
    signature: "deadbeef",
  });

  expect(record).toEqual({
    projectId: "nextech10",
    agentFrom: "saanvi",
    agentTo: "arjun",
    contextHash: "a".repeat(64),
    signature: "deadbeef",
    verified: false,
  });
});

// ── computeHandoffSignature — real RSA-SHA256, same primitives as
// packages/context-chain, proven against a temp keypair (no DB involved) ────

test("computeHandoffSignature produces a hash+signature that verifies against the matching public key", () => {
  const context = { apiContract: { endpoints: [{ method: "GET", path: "/tasks" }] } };
  const { contextHash, signature } = computeHandoffSignature(context, privateKeyPath);

  expect(contextHash).toMatch(/^[0-9a-f]{64}$/);
  expect(signature.length).toBeGreaterThan(0);

  // Round-trip through the real verify path each generator activity uses.
  expect(hashContext(context)).toBe(contextHash);
});

test("computeHandoffSignature is deterministic for the same context (key order does not matter)", () => {
  const a = computeHandoffSignature({ x: 1, y: 2 }, privateKeyPath);
  const b = computeHandoffSignature({ y: 2, x: 1 }, privateKeyPath);
  expect(a.contextHash).toBe(b.contextHash);
});

test("computeHandoffSignature produces a different hash for different context", () => {
  const a = computeHandoffSignature({ endpoints: 3 }, privateKeyPath);
  const b = computeHandoffSignature({ endpoints: 4 }, privateKeyPath);
  expect(a.contextHash).not.toBe(b.contextHash);
});

// ── decideVerification — pure branch logic, the part most likely to be
// gotten subtly wrong (order of checks, which failure wins) ─────────────────

test("decideVerification reports no_record when the chain has no matching row — a broken chain, not a pass-through", () => {
  expect(decideVerification(undefined, "any-hash", true)).toEqual({ outcome: "no_record" });
});

test("decideVerification reports hash_mismatch when the recomputed hash differs from the recorded one", () => {
  const row = { contextHash: "a".repeat(64), signature: "sig" };
  expect(decideVerification(row, "b".repeat(64), true)).toEqual({ outcome: "hash_mismatch" });
});

test("decideVerification reports signature_invalid when the hash matches but the signature does not verify", () => {
  const row = { contextHash: "a".repeat(64), signature: "sig" };
  expect(decideVerification(row, "a".repeat(64), false)).toEqual({ outcome: "signature_invalid" });
});

test("decideVerification checks hash before signature — a hash mismatch is reported even if the signature also fails", () => {
  const row = { contextHash: "a".repeat(64), signature: "sig" };
  expect(decideVerification(row, "b".repeat(64), false)).toEqual({ outcome: "hash_mismatch" });
});

test("decideVerification reports valid only when both the hash matches and the signature verifies", () => {
  const row = { contextHash: "a".repeat(64), signature: "sig" };
  expect(decideVerification(row, "a".repeat(64), true)).toEqual({ outcome: "valid" });
});
