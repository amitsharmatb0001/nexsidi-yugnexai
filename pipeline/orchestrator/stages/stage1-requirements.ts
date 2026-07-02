// Stage 1 — Requirements gathering + task decomposition.
// Calls Saanvi (the real requirements agent) to turn raw user input into a
// locked ProjectSpec, then calls Arjun (the real planner) to turn that spec
// into a full BuildPlan — API contract, DB schema, and independent per-agent
// task lists (agents/arjun/src/index.ts, run(spec): Promise<BuildPlan>).
//
// Both the spec and the plan are returned: the spec still flows to Stage 2's
// human approval gate (it reads spec.name/description/features, which
// BuildPlan does not carry), while the plan flows to Stage 3 so Aanya's
// generator receives the real BuildPlan shape it expects instead of a raw
// ProjectSpec. See the Task 10 report for the full rationale.
//
// The DAG is built from Arjun's real per-agent task breakdown (one node per
// shubham/aanya/pranav task). Arjun guarantees independenceVerified — the
// three agents' tasks don't depend on each other's in-progress files — so
// there is no inter-task dependency data to encode yet; each node has
// dependsOn: []. If Arjun ever starts emitting real dependency edges between
// tasks, this is the place to consume them.
import { run as runSaanvi, type ProjectSpec } from "../../../agents/saanvi/src/index.ts";
import { run as runArjun, type BuildPlan, type GeneratorTask } from "../../../agents/arjun/src/index.ts";
import { buildDag } from "../dag.ts";
import type { Dag, DagTask } from "../types.ts";

export interface Stage1Result {
  spec: ProjectSpec;
  plan: BuildPlan;
  dag: Dag;
}

export async function runStage1(projectId: string, userInput: string): Promise<Stage1Result> {
  const spec = await runSaanvi(projectId, userInput);
  const plan = await runArjun(spec);

  const dagTasks: DagTask[] = [
    ...taskGroupToDagTasks("shubham", plan.shubhamTasks),
    ...taskGroupToDagTasks("aanya", plan.aanyaTasks),
    ...taskGroupToDagTasks("pranav", plan.pranavTasks),
  ];

  const dag = buildDag(
    dagTasks.length > 0
      ? dagTasks
      : [
          {
            id: "requirements",
            description: `Requirements locked for "${plan.appName}"`,
            complexity: 1,
            dependsOn: [],
          },
        ]
  );

  return { spec, plan, dag };
}

function taskGroupToDagTasks(agent: string, tasks: GeneratorTask[]): DagTask[] {
  return tasks.map((task, index) => ({
    id: `${agent}-${index}`,
    description: task.description,
    complexity: Math.max(task.outputFiles.length, 1),
    dependsOn: [], // independenceVerified: no cross-agent ordering to encode yet
  }));
}
