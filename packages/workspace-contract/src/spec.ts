import { createHash } from "crypto";
import type { WorkspaceSpec } from "./types.ts";

const ROOT_METADATA = new Set([
  "hash",
  "status",
  "createdAt",
  "approvedAt",
  "approvedBy",
]);

function canonical(value: unknown, isRoot = false): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      items.push(canonical(value[index]));
    }
    return `[${items.join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => !isRoot || !ROOT_METADATA.has(key))
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

export function computeSpecHash(
  spec:
    | Omit<WorkspaceSpec, "hash">
    | Omit<WorkspaceSpec, "hash" | "createdAt">,
): string {
  return createHash("sha256").update(canonical(spec, true)).digest("hex");
}

export function assertApprovedSpec(spec: WorkspaceSpec): void {
  if (spec.status !== "approved" || !spec.approvedAt || !spec.approvedBy) {
    throw new Error("spec_not_approved");
  }
  if (computeSpecHash(spec) !== spec.hash) {
    throw new Error("approved_spec_hash_mismatch");
  }
}
