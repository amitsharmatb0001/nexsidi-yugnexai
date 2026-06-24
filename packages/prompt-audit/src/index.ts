// Nice-to-have #13: Encrypted prompt audit log
//
// Security Layer 6 says prompts are hashed, never stored — but incident
// response (Kunal) needs to reconstruct what was asked.
//
// Solution: AES-256-GCM encryption at rest.
//   - SHA-256 hash for quick lookup (fast, non-reversible)
//   - Ciphertext for full audit (reversible with key)
//   - Key rotation tracked via keyVersion field
//
// Stored in: prompt_audit table (see packages/db/src/schema.ts)

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export interface SealedPrompt {
  hash: string;         // SHA-256 hex — used for quick dedup/lookup
  ciphertext: string;   // AES-256-GCM hex
  iv: string;           // 12-byte GCM nonce hex
  tag: string;          // 16-byte auth tag hex
  keyVersion: number;   // allows key rotation without re-encrypting old records
}

function loadKey(): Buffer {
  const hex = process.env.PROMPT_AUDIT_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("PROMPT_AUDIT_KEY must be a 64-char hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function sealPrompt(prompt: string, keyVersion = 1): SealedPrompt {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(prompt, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const hash = createHash("sha256").update(prompt).digest("hex");

  return {
    hash,
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    keyVersion,
  };
}

export function unsealPrompt(sealed: SealedPrompt): string {
  const key = loadKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(sealed.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(sealed.tag, "hex"));
  return (
    decipher.update(Buffer.from(sealed.ciphertext, "hex")).toString("utf8") +
    decipher.final("utf8")
  );
}

// Returns true if auditing is enabled (can be disabled per-env for local dev)
export function isAuditEnabled(): boolean {
  return process.env.PROMPT_AUDIT_ENABLED !== "false";
}
