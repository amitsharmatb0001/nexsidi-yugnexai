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
