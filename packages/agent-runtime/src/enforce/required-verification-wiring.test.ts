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

  // 2026-08-24 (Workstream 4): Aanya's array grew a `cat <file>` entry per
  // required App Router convention file (not-found.tsx/error.tsx/
  // global-error.tsx/icon.svg — see her own required-verification-commands
  // comment for why those need a DIFFERENT mechanical check than tsc/build).
  // Checking for the individual command strings, not one exact array
  // literal, keeps this test a real regression guard on the tsc/build gate
  // specifically without re-breaking on the next legitimate addition to
  // that array.
  expect(frontend).toContain('"npx tsc --noEmit"');
  expect(frontend).toContain('"npx next build"');
  expect(backend).toContain('requiredVerificationCommands: ["npx tsc --noEmit", "npm run build"]');
});

test("Aanya requires the App Router convention files a real production site has — not-found/error/global-error/favicon", () => {
  // 2026-08-24 (Workstream 4): confirmed live, page-by-page, against a real
  // 15-page production site — the generated app had ZERO of these. They're
  // Next.js file conventions (auto-discovered by filename, never imported),
  // so `next build` doesn't fail on a missing one the way it does for
  // Header/Footer — `cat <path>` (nonzero exit if absent) is the mechanical
  // substitute; see the required-files doctrine for what each must contain.
  const frontend = read("../../../../agents/generators/aanya/src/index.ts");
  expect(frontend).toContain('"cat app/not-found.tsx"');
  expect(frontend).toContain('"cat app/error.tsx"');
  expect(frontend).toContain('"cat app/global-error.tsx"');
  expect(frontend).toContain('"cat app/icon.svg"');
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
