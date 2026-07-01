import type { DagTask, Dag } from "./types.ts";

export class CycleDetectedError extends Error {
  constructor(cyclePath: string[]) {
    super(`Cycle detected in task graph: ${cyclePath.join(" -> ")}`);
  }
}

export class DanglingReferenceError extends Error {
  constructor(taskId: string, missingDeps: string[]) {
    super(
      `Task "${taskId}" depends on non-existent tasks: ${missingDeps.join(", ")}`
    );
  }
}

export function buildDag(tasks: DagTask[]): Dag {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  // Validation pass 1: check for dangling references
  for (const task of tasks) {
    const missingDeps = task.dependsOn.filter((depId) => !byId.has(depId));
    if (missingDeps.length > 0) {
      throw new DanglingReferenceError(task.id, missingDeps);
    }
  }

  // Validation pass 2: cycle detection using DFS
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string, path: string[]): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new CycleDetectedError([...path, id]);
    visiting.add(id);
    const task = byId.get(id);
    if (task) {
      for (const dep of task.dependsOn) visit(dep, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const task of tasks) visit(task.id, []);
  return { tasks };
}
