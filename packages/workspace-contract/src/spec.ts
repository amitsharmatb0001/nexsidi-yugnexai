import { createHash } from "crypto";
import type { WorkspaceSpec } from "./types.ts";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;

  const record = value as Record<string, unknown>;
  const metadata = new Set([
    "hash",
    "status",
    "createdAt",
    "approvedAt",
    "approvedBy",
  ]);
  return `{${Object.keys(record)
    .filter((key) => !metadata.has(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

export function computeSpecHash(
  spec:
    | Omit<WorkspaceSpec, "hash">
    | Omit<WorkspaceSpec, "hash" | "createdAt">,
): string {
  return createHash("sha256").update(canonical(spec)).digest("hex");
}

export function assertApprovedSpec(spec: WorkspaceSpec): void {
  if (spec.status !== "approved" || !spec.approvedAt || !spec.approvedBy) {
    throw new Error("spec_not_approved");
  }
  if (computeSpecHash(spec) !== spec.hash) {
    throw new Error("approved_spec_hash_mismatch");
  }
}
