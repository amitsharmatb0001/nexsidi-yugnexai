// Stage 1 — Requirements gathering.
// Calls Saanvi (the real requirements agent) to turn raw user input into a
// locked ProjectSpec, then builds a task DAG for downstream orchestration.
//
// LIMITATION: Saanvi's current output (ProjectSpec — see
// agents/saanvi/src/index.ts) does not include a task breakdown. Task
// decomposition into a real dependency graph is Arjun's job
// (agents/arjun/src/index.ts, run(spec): Promise<BuildPlan>), which is not
// wired into any pipeline stage yet. Until that wiring exists, this stage
// builds a minimal single-task DAG (one node, no dependencies) purely so
// callers that expect a `Dag` shape have something valid to consume. This is
// a placeholder, not a real task graph — see Task 10 report for details.
import { run as runSaanvi, type ProjectSpec } from "../../../agents/saanvi/src/index.ts";
import { buildDag } from "../dag.ts";
import type { Dag } from "../types.ts";

export interface Stage1Result {
  spec: ProjectSpec;
  dag: Dag;
}

export async function runStage1(projectId: string, userInput: string): Promise<Stage1Result> {
  const spec = await runSaanvi(projectId, userInput);

  const dag = buildDag([
    {
      id: "requirements",
      description: `Requirements locked for "${spec.name}"`,
      complexity: 1,
      dependsOn: [],
    },
  ]);

  return { spec, dag };
}
