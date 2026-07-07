// Phase 5 Task 5 (final-bundle/phase5-harness-enforcement-plan.md): output
// contract validator (Rule 9). Called at every agent boundary BEFORE the
// context-chain hash is computed — a malformed handoff is rejected back to
// the producing agent with the exact zod errors as a retry message (max 2
// contract retries, then the strike counter takes over), never hashed and
// forwarded as if it were valid. The chain must certify integrity of VALID
// artifacts, not just "some bytes we happened to receive."
import { z } from "zod";
import {
  ProjectSpecSchema,
  BuildPlanSchema,
  DeployResultSchema,
  ReadyToBuildSchema,
  VerdictSchema,
} from "./contracts/schemas.ts";

export type ContractKind = "project_spec" | "build_plan" | "deploy_result" | "ready_to_build" | "verdict";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

function validateJson<T>(raw: string, schema: z.ZodType<T>): ValidationResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, errors: [`Invalid JSON: ${String(err)}`] };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) return { ok: false, errors: formatZodErrors(result.error) };
  return { ok: true, value: result.data };
}

// Maya's __READY_TO_BUILD__{...} marker (agents/maya/src/index.ts) may be
// preceded by conversational text but must be immediately followed by
// exactly one valid JSON object and nothing else — JSON.parse itself
// rejects trailing non-whitespace after a complete value, which is what
// catches "...} hope that helps!" style trailing text.
const READY_TO_BUILD_MARKER = "__READY_TO_BUILD__";

function validateReadyToBuild(raw: string): ValidationResult<z.infer<typeof ReadyToBuildSchema>> {
  const idx = raw.indexOf(READY_TO_BUILD_MARKER);
  if (idx === -1) {
    return { ok: false, errors: [`Expected output to contain the "${READY_TO_BUILD_MARKER}" marker`] };
  }
  const jsonPart = raw.slice(idx + READY_TO_BUILD_MARKER.length);
  return validateJson(jsonPart, ReadyToBuildSchema);
}

// Normalized PASS | NEEDS_WORK first-line contract — see
// contracts/schemas.ts's header comment for how this relates to the two
// existing ad-hoc verdict formats it generalizes (tier3-review.ts's
// FINDINGS/VERDICT: READY|NEEDS_WORK block and pipeline/activities/
// index.ts's PASS/FAIL:<reason> check).
function validateVerdict(raw: string): ValidationResult<z.infer<typeof VerdictSchema>> {
  const firstLine = (raw.split("\n")[0] ?? "").trim();
  if (firstLine === "PASS") {
    return { ok: true, value: { verdict: "PASS" } };
  }
  if (firstLine === "NEEDS_WORK") {
    return { ok: true, value: { verdict: "NEEDS_WORK" } };
  }
  if (firstLine.startsWith("NEEDS_WORK:")) {
    const reason = firstLine.slice("NEEDS_WORK:".length).trim();
    return { ok: true, value: { verdict: "NEEDS_WORK", reason: reason || undefined } };
  }
  return { ok: false, errors: [`First line must be exactly "PASS" or "NEEDS_WORK" (optionally ": <reason>") — got: "${firstLine}"`] };
}

export function validateHandoff(kind: "project_spec", raw: string): ValidationResult<z.infer<typeof ProjectSpecSchema>>;
export function validateHandoff(kind: "build_plan", raw: string): ValidationResult<z.infer<typeof BuildPlanSchema>>;
export function validateHandoff(kind: "deploy_result", raw: string): ValidationResult<z.infer<typeof DeployResultSchema>>;
export function validateHandoff(kind: "ready_to_build", raw: string): ValidationResult<z.infer<typeof ReadyToBuildSchema>>;
export function validateHandoff(kind: "verdict", raw: string): ValidationResult<z.infer<typeof VerdictSchema>>;
export function validateHandoff(kind: ContractKind, raw: string): ValidationResult<unknown> {
  switch (kind) {
    case "project_spec":
      return validateJson(raw, ProjectSpecSchema);
    case "build_plan":
      return validateJson(raw, BuildPlanSchema);
    case "deploy_result":
      return validateJson(raw, DeployResultSchema);
    case "ready_to_build":
      return validateReadyToBuild(raw);
    case "verdict":
      return validateVerdict(raw);
  }
}
