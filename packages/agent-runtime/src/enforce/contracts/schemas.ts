// Phase 5 Task 5 (final-bundle/phase5-harness-enforcement-plan.md): zod
// schemas mirroring EXISTING agent output types — semantics are NOT
// redefined here, only re-expressed as runtime-checkable contracts:
//   - ProjectSpec:   agents/saanvi/src/index.ts
//   - BuildPlan:     agents/arjun/src/index.ts
//   - DeployResult:  agents/riya/src/index.ts
//   - ReadyToBuild:  agents/maya/src/index.ts's __READY_TO_BUILD__{...} marker
//   - Verdict:       agents/tilotma/src/tier3-review.ts's VERDICT: READY|NEEDS_WORK
//                     block and pipeline/activities/index.ts's PASS/FAIL:<reason>
//                     first-line check, normalized to one canonical
//                     PASS | NEEDS_WORK first-line contract for future callers.
import { z } from "zod";

// ── ProjectSpec (agents/saanvi/src/index.ts) ────────────────────────────────

const FeatureSchema = z.object({
  name: z.string(),
  description: z.string(),
  userStories: z.array(z.string()),
});

const ApiEndpointSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  description: z.string(),
  auth: z.boolean(),
  requestBody: z.record(z.unknown()).nullable(),
  responseBody: z.record(z.unknown()),
});

const DbFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["uuid", "text", "varchar", "integer", "boolean", "timestamptz", "date", "jsonb"]),
  nullable: z.boolean(),
  primaryKey: z.boolean().optional(),
  unique: z.boolean().optional(),
  references: z.object({ table: z.string(), field: z.string() }).optional(),
  default: z.string().optional(),
});

const DbTableSchema = z.object({
  name: z.string(),
  fields: z.array(DbFieldSchema),
});

export const ProjectSpecSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  description: z.string(),
  appType: z.literal("web"),
  features: z.array(FeatureSchema),
  auth: z.object({ provider: z.literal("clerk"), features: z.array(z.enum(["sign-in", "sign-up"])) }),
  apiEndpoints: z.array(ApiEndpointSchema),
  dbTables: z.array(DbTableSchema),
  successCriteria: z.array(z.string()),
  lockedAt: z.string(),
  specHash: z.string(),
});

// ── BuildPlan (agents/arjun/src/index.ts) ───────────────────────────────────

const RestEndpointSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  description: z.string(),
  auth: z.boolean(),
  requestType: z.string(),
  responseType: z.string(),
  errorCodes: z.array(z.number()),
});

const DrizzleColumnSchema = z.object({
  name: z.string(),
  drizzleType: z.string(),
  constraints: z.array(z.string()),
  references: z.string().optional(),
});

const DrizzleTableSchema = z.object({
  name: z.string(),
  columns: z.array(DrizzleColumnSchema),
  indexes: z.array(z.string()),
});

const GeneratorTaskSchema = z.object({
  description: z.string(),
  outputFiles: z.array(z.string()),
});

export const BuildPlanSchema = z.object({
  projectId: z.string(),
  appName: z.string(),
  appDescription: z.string(),
  sharedTypes: z.string(),
  apiContract: z.object({
    baseUrl: z.literal("http://localhost:3001"),
    endpoints: z.array(RestEndpointSchema),
  }),
  dbSchema: z.object({ tables: z.array(DrizzleTableSchema) }),
  shubhamTasks: z.array(GeneratorTaskSchema),
  aanyaTasks: z.array(GeneratorTaskSchema),
  pranavTasks: z.array(GeneratorTaskSchema),
  independenceVerified: z.boolean(),
  buildPlanHash: z.string(),
});

// ── DeployResult (agents/riya/src/index.ts) ─────────────────────────────────

export const DeployResultSchema = z.object({
  success: z.boolean(),
  appUrl: z.string(),
  githubRepo: z.string().nullable(),
  errors: z.array(z.string()),
});

// ── ReadyToBuild (agents/maya/src/index.ts's __READY_TO_BUILD__ marker) ────

export const ReadyToBuildSchema = z.object({
  name: z.string(),
  description: z.string(),
  features: z.array(z.string()),
});

// ── Verdict (normalized PASS | NEEDS_WORK first-line contract) ─────────────

export const VerdictSchema = z.object({
  verdict: z.enum(["PASS", "NEEDS_WORK"]),
  reason: z.string().optional(),
});
