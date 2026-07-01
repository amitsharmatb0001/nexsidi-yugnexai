import { test, expect } from "bun:test";
import { buildDag, CycleDetectedError, DanglingReferenceError } from "./dag.ts";

test("buildDag accepts a valid acyclic graph", () => {
  const dag = buildDag([
    { id: "db-schema", description: "Design schema", complexity: 3, dependsOn: [] },
    { id: "backend-api", description: "Build API", complexity: 5, dependsOn: ["db-schema"] },
    { id: "frontend-integrate", description: "Wire UI", complexity: 4, dependsOn: ["backend-api"] },
  ]);
  expect(dag.tasks.length).toBe(3);
});

test("buildDag throws CycleDetectedError on a circular dependency", () => {
  expect(() =>
    buildDag([
      { id: "a", description: "A", complexity: 1, dependsOn: ["b"] },
      { id: "b", description: "B", complexity: 1, dependsOn: ["a"] },
    ])
  ).toThrow(CycleDetectedError);
});

test("buildDag throws DanglingReferenceError when dependsOn references non-existent task", () => {
  expect(() =>
    buildDag([
      { id: "task-1", description: "First task", complexity: 2, dependsOn: ["nonexistent-task"] },
    ])
  ).toThrow(DanglingReferenceError);
});

test("buildDag handles multiple dangling references with clear error message", () => {
  expect(() =>
    buildDag([
      { id: "task-a", description: "A", complexity: 1, dependsOn: ["missing-1", "missing-2"] },
      { id: "task-b", description: "B", complexity: 1, dependsOn: [] },
    ])
  ).toThrow(DanglingReferenceError);
});

test("buildDag accepts complex valid DAG with multiple dependencies", () => {
  const dag = buildDag([
    { id: "database", description: "Set up DB", complexity: 3, dependsOn: [] },
    { id: "auth-service", description: "Auth API", complexity: 4, dependsOn: ["database"] },
    { id: "user-service", description: "User API", complexity: 4, dependsOn: ["database"] },
    { id: "frontend", description: "Frontend UI", complexity: 5, dependsOn: ["auth-service", "user-service"] },
  ]);
  expect(dag.tasks.length).toBe(4);
});

test("buildDag detects self-referential cycle", () => {
  expect(() =>
    buildDag([
      { id: "self-ref", description: "Self loop", complexity: 1, dependsOn: ["self-ref"] },
    ])
  ).toThrow(CycleDetectedError);
});
