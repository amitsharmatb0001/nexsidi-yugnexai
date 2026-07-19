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

test("nested assumption status changes the hash and invalidates approval", () => {
  const withAssumption = {
    ...draft,
    assumptions: [
      {
        id: "assumption-1",
        key: "hosting",
        value: "Local deployment",
        status: "proposed" as const,
      },
    ],
  };
  const approved = {
    ...withAssumption,
    status: "approved",
    hash: computeSpecHash(withAssumption),
    createdAt: "2026-07-19T00:00:00.000Z",
    approvedAt: "2026-07-19T00:01:00.000Z",
    approvedBy: "user-1",
  } as WorkspaceSpec;
  const mutated = {
    ...approved,
    assumptions: [{ ...approved.assumptions[0]!, status: "approved" as const }],
  };

  expect(() => assertApprovedSpec(approved)).not.toThrow();
  expect(computeSpecHash(mutated)).not.toBe(approved.hash);
  expect(() => assertApprovedSpec(mutated)).toThrow(
    "approved_spec_hash_mismatch",
  );
});

test("hash matches JSON persistence when an object property is undefined", () => {
  const withUndefined = {
    ...draft,
    design: { ...draft.design, colors: undefined },
  };
  const persisted = JSON.parse(JSON.stringify(withUndefined)) as typeof draft;

  expect(computeSpecHash(withUndefined)).toBe(computeSpecHash(persisted));
});

test("hash matches JSON persistence when an array item is undefined", () => {
  const withUndefined = {
    ...draft,
    design: { ...draft.design, references: ["kept", undefined] },
  } as unknown as Omit<WorkspaceSpec, "hash" | "createdAt">;
  const persisted = JSON.parse(JSON.stringify(withUndefined)) as typeof withUndefined;

  expect(computeSpecHash(withUndefined)).toBe(computeSpecHash(persisted));
});
