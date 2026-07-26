import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf-8");

test("all provider loops pass configured verification commands to the completion gate", () => {
  for (const file of ["../loop.ts", "../gemini-loop.ts", "../claude-loop.ts"]) {
    const source = read(file);
    expect(source).toContain("config.requiredVerificationCommands");
  }
});

test("frontend and backend generators require their TypeScript verification command", () => {
  const frontend = read("../../../../agents/generators/aanya/src/index.ts");
  const backend = read("../../../../agents/generators/shubham/src/index.ts");

  expect(frontend).toContain('requiredVerificationCommands: ["npx tsc --noEmit", "npx next build"]');
  expect(backend).toContain('requiredVerificationCommands: ["npx tsc --noEmit", "npm run build"]');
});

test("all provider loops pass configured evidence kinds to the completion gate", () => {
  for (const file of ["../loop.ts", "../gemini-loop.ts", "../claude-loop.ts"]) {
    const source = read(file);
    expect(source).toContain("config.requiredEvidenceKinds");
  }
});

test("Riya (deploy agent) requires http_check evidence — docker success alone is not proof", () => {
  // 2026-07-25 (P5.W5.4): Riya's tools are docker_compose/http_request, not
  // shell commands, so requiredVerificationCommands can't express "you must
  // have called http_request successfully." Without requiredEvidenceKinds,
  // Riya could self-report verification_passed:true after `docker_compose
  // up` alone — the exact false-success bug that shipped a build where
  // every write 500'd because migrations never ran.
  const riya = read("../../../../agents/riya/src/index.ts");
  expect(riya).toContain('requiredEvidenceKinds: ["http_check"]');
});
