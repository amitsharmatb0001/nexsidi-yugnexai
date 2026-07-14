import { test, expect } from "bun:test";
import { buildAgentPrompt, stripDevDependencies, buildCustomEnvLocal, buildScaffoldTsconfig, buildScaffoldNextConfig, buildFixTask } from "./index.ts";

test("preview mode prompt instructs mock data, no real API calls", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).toContain("mock");
  expect(prompt).not.toContain("Bearer token from useAuth().getToken()");
});

test("integrate mode prompt instructs real API wiring", () => {
  const prompt = buildAgentPrompt("integrate");
  expect(prompt).toContain("Bearer token from useAuth().getToken()");
});

// Full-system audit E1: vendored NexUI packages declare devDependencies
// (@types/react@^18) that conflict with generated apps' React 19 root
// deps — confirmed via run logs 8/9/10 where every model fought a nested
// vendor/nexui-react/node_modules/@types/react (v18) conflict. Stripping
// devDependencies from the vendored package.json before it's ever written
// to the generated project prevents npm from ever installing the
// conflicting nested copy.
test("stripDevDependencies removes the devDependencies key entirely", () => {
  const pkg = JSON.stringify({
    name: "@yugnex/nexui-react",
    version: "2.0.1",
    dependencies: {},
    devDependencies: { typescript: "^5.5.0", "@types/react": "^18.0.0" },
  });
  const result = JSON.parse(stripDevDependencies(pkg));
  expect(result.devDependencies).toBeUndefined();
  expect(result.name).toBe("@yugnex/nexui-react"); // everything else preserved
});

test("stripDevDependencies is a no-op when devDependencies is already absent", () => {
  const pkg = JSON.stringify({ name: "x", version: "1.0.0" });
  const result = JSON.parse(stripDevDependencies(pkg));
  expect(result).toEqual({ name: "x", version: "1.0.0" });
});

test("stripDevDependencies preserves formatting-independent JSON validity on malformed input", () => {
  // Defensive: if the vendored package.json is ever unreadable/corrupt, don't
  // throw and abort the whole generation — return the original content
  // unchanged so the (unfixed) conflict is a build error, not a crash.
  const result = stripDevDependencies("not valid json {{{");
  expect(result).toBe("not valid json {{{");
});

// Found live during the Phase B stress-test gate (stress2phaseb, 2026-07-04):
// .env.local was reading process.env.CLERK_PUBLISHABLE_KEY, but the real
// worktree .env names it NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (confirmed by
// grepping .env/.env.example) — the mismatch meant every generated preview
// build shipped an EMPTY Clerk publishable key, which crashes Next.js's
// static prerendering of /_not-found with "Missing publishableKey". Neither
// the NIM agent nor the Claude escalation (80 combined iterations) could
// fix this — it's a scaffold/env-generation bug, not something editable
// from inside the generated project.
test("buildCustomEnvLocal includes the backend port in NEXT_PUBLIC_API_URL and JWT_SECRET", () => {
  const content = buildCustomEnvLocal("4500");
  expect(content).toContain("NEXT_PUBLIC_API_URL=http://localhost:4500/api/v1");
  expect(content).toContain("JWT_SECRET=");
});

// Diagnosis 2026-07-04 (stress2/stress3 forensics): the scaffold tsconfig
// excluded only node_modules, so Next's typecheck compiled vendor/nexui-react/
// src — which is React-19-type-broken — and EVERY run burned 10-20 iterations
// until a model discovered it must add "vendor" to exclude (stress3: Claude
// iteration 23). Ship the fix in the scaffold instead.
test("scaffold tsconfig excludes vendor so Next never typechecks vendored NexUI source", () => {
  const tsconfig = JSON.parse(buildScaffoldTsconfig());
  expect(tsconfig.exclude).toContain("node_modules");
  expect(tsconfig.exclude).toContain("vendor");
});

// Same forensics: scaffold next.config shipped experimental.serverComponents-
// ExternalPackages — renamed upstream in Next 15, invalid on Next 16.2. Claude
// deleted it in BOTH stress2 and stress3 (identical edit, iteration 11 each).
test("scaffold next.config has no dead experimental key and keeps transpilePackages", () => {
  const config = buildScaffoldNextConfig();
  expect(config).not.toContain("serverComponentsExternalPackages");
  expect(config).toContain("transpilePackages");
  expect(config).toContain("@yugnex/nexui-react");
});

// A6 (full-system audit, Phase C): same fix-loop pattern as Shubham's
// buildFixTask — targets the SAME outputDir run() already wrote to, with a
// fix-focused task instead of a from-scratch build task.
test("buildFixTask numbers each finding and instructs targeted fixes, not a rewrite", () => {
  const task = buildFixTask([
    "[logic/HIGH] frontend/lib/api.ts: dueDate type mismatch (Date vs string)",
  ]);
  expect(task).toContain("1. [logic/HIGH] frontend/lib/api.ts: dueDate type mismatch (Date vs string)");
  expect(task).toContain("Fix ONLY these specific issues");
});

test("buildFixTask instructs verification before task_complete", () => {
  const task = buildFixTask(["some finding"]);
  expect(task.toLowerCase()).toContain("verif");
  expect(task).toContain("task_complete");
});
