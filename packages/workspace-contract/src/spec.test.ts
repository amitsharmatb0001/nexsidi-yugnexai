import { expect, test } from "bun:test";
import { assertApprovedSpec, computeSpecHash } from "./spec.ts";
import type { WorkspaceSpec } from "./types.ts";

const draft = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "abc123def456",
  version: 1,
  status: "draft",
  originalRequest: "Build Nextech",
  confirmedFacts: [],
  questions: [],
  assumptions: [],
  scope: [],
  userJourneys: [],
  pages: [],
  dataModel: [],
  apiContracts: [],
  auth: { mode: "none", roles: [] },
  design: { direction: "deep black and warm gold" },
  sources: [],
  acceptanceCriteria: [],
} satisfies Omit<WorkspaceSpec, "hash" | "createdAt">;

test("hashes canonical spec content deterministically", () => {
  expect(computeSpecHash(draft)).toBe(computeSpecHash({ ...draft }));
  expect(computeSpecHash(draft)).toMatch(/^[a-f0-9]{64}$/);
});

test("rejects an approved record whose hash no longer matches", () => {
  const spec = {
    ...draft,
    status: "approved",
    hash: "0".repeat(64),
    createdAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    approvedBy: "user-1",
  } as WorkspaceSpec;
  expect(() => assertApprovedSpec(spec)).toThrow("approved_spec_hash_mismatch");
});
