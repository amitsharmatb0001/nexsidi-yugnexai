import { createHash } from "crypto";

// Deterministic JSON serialisation — keys sorted recursively
export function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(",")}]`;
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`);
  return `{${sorted.join(",")}}`;
}

// Patent Claim 1: SHA-256 hash of canonicalised context
export function hashContext(context: unknown): string {
  return createHash("sha256").update(canonicalize(context)).digest("hex");
}
