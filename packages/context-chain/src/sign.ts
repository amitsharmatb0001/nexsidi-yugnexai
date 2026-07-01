import { createSign, createVerify } from "crypto";
import { readFileSync } from "fs";

// Patent Claim 7: RSA-SHA256 signature on every agent output
export function signOutput(output: unknown, privateKeyPath: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(JSON.stringify(output));
  return signer.sign(readFileSync(privateKeyPath), "hex");
}

export function verifySignature(
  output: unknown,
  signature: string,
  publicKeyPath: string,
): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(JSON.stringify(output));
  return verifier.verify(readFileSync(publicKeyPath), signature, "hex");
}
