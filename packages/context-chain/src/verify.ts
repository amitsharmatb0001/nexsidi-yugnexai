import { hashContext } from "./hash.ts";
import { verifySignature } from "./sign.ts";

export interface VerifyResult {
  valid: boolean;
  reason?: "hash_mismatch" | "signature_invalid";
}

// Patent Claim 3: verification + automatic rollback trigger on mismatch
export function verifyContext(
  context: unknown,
  expectedHash: string,
  signature: string,
  publicKeyPath: string,
): VerifyResult {
  if (hashContext(context) !== expectedHash) {
    return { valid: false, reason: "hash_mismatch" };
  }
  if (!verifySignature(context, signature, publicKeyPath)) {
    return { valid: false, reason: "signature_invalid" };
  }
  return { valid: true };
}

// Throws a structured error that the Temporal activity catches and rolls back
export function triggerRollback(projectId: string, reason: string): never {
  throw Object.assign(new Error(`ROLLBACK:${projectId}`), {
    rollback: true,
    projectId,
    reason,
  });
}
