import { test, expect } from "bun:test";
import { buildAgentPrompt, buildAgentTask, stripDevDependencies, buildCustomEnvLocal, buildScaffoldTsconfig, buildScaffoldNextConfig, buildFixTask } from "./index.ts";
import type { BuildPlan } from "../../../arjun/src/index.ts";
import { FALLBACK_BRIEF } from "../../../vanya/src/index.ts";

const FIX_TEST_PLAN: BuildPlan = {
  projectId: "fixtest",
  appName: "Greenway Estates Portal",
  appDescription: "A property management platform for landlords, tenants, and staff.",
  designBrief: FALLBACK_BRIEF,
  features: [],
  sharedTypes: "export interface Application { id: string; }",
  apiContract: { baseUrl: "http://localhost:3001", endpoints: [] },
  dbSchema: { tables: [] },
  shubhamTasks: [],
  aanyaTasks: [],
  pranavTasks: [],
  independenceVerified: true,
  buildPlanHash: "deadbeef",
};

test("preview mode prompt instructs mock data, no real API calls", () => {
  const prompt = buildAgentPrompt("preview");
  expect(prompt).toContain("mock");
  expect(prompt).not.toContain("Bearer token from useAuth().getToken()");
});

test("integrate mode prompt instructs real API wiring", () => {
  const prompt = buildAgentPrompt("integrate");
  expect(prompt).toContain("read the 'token' cookie");
  expect(prompt).toContain('"Authorization: Bearer <token>"');
  expect(prompt).not.toContain("useAuth().getToken()");
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
test("buildCustomEnvLocal emits the backend origin once and leaves route prefixes to the app", () => {
  const content = buildCustomEnvLocal("4500");
  expect(content).toContain("NEXT_PUBLIC_API_URL=http://localhost:4500\n");
  expect(content).not.toContain("localhost:4500/api/v1");
  expect(content).toContain("JWT_SECRET=");
});

// 2026-07-26 (agent-autonomy-assessment follow-on, live proof): this used
// to fall back to the literal string "default_dev_secret" whenever
// process.env.JWT_SECRET was unset at generation time. Confirmed live in
// complex1's shipped frontend/.env.local: JWT_SECRET=default_dev_secret,
// while the deployed backend's docker-compose.yml independently got a
// THIRD, different hardcoded value from the live Riya agent — three
// uncoordinated fallbacks, no single source of truth. Riya's deploy-time
// write (agents/riya/src/index.ts) is now the authoritative one and always
// overwrites this file with a real generated secret before the app starts,
// but this scaffold-time placeholder must never be a fixed, predictable
// string either.
test("buildCustomEnvLocal never falls back to a fixed, predictable JWT_SECRET value", () => {
  const content = buildCustomEnvLocal("4500");
  expect(content).not.toContain("default_dev_secret");
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
//
// 2026-07-26 (agent-autonomy-assessment F1/F2): same root-cause fix as
// Shubham's identical test file — see that file's header comment for the
// live evidence. "Fix ONLY these specific issues" is gone; root-cause
// reasoning and full system context are now instructed.
test("buildFixTask numbers each finding", () => {
  const task = buildFixTask(
    ["[logic/HIGH] frontend/lib/api.ts: dueDate type mismatch (Date vs string)"],
    FIX_TEST_PLAN,
  );
  expect(task).toContain("1. [logic/HIGH] frontend/lib/api.ts: dueDate type mismatch (Date vs string)");
});

test("buildFixTask instructs root-cause diagnosis, not blind point-fixing", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task).not.toContain("Fix ONLY these specific issues");
  expect(task).not.toContain("do not refactor working code that wasn't flagged");
  expect(task.toLowerCase()).toContain("root cause");
});

test("buildFixTask includes the full system context, not just the bug report", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task).toContain("Greenway Estates Portal");
});

test("buildFixTask instructs verification before task_complete", () => {
  const task = buildFixTask(["some finding"], FIX_TEST_PLAN);
  expect(task.toLowerCase()).toContain("verif");
  expect(task).toContain("task_complete");
});

// ── Step 1: the generator must actually RECEIVE the spec's requirements ──────
// 2026-08-04 (live, verify4617991): buildAgentTask's prompt says "Every page
// must show real content from the project spec" — but the spec was never
// included in the message. BuildPlan had no features field at all, so Aanya
// had only appDescription (one paragraph) plus Arjun's 9-word task label
// "Implement Services and Products catalog pages". It produced a 23-line page
// with 4 services when the spec named 9. The model wasn't underperforming; it
// was never told what to build.
const PLAN_WITH_FEATURES: BuildPlan = {
  ...FIX_TEST_PLAN,
  features: [
    {
      name: "Service & Product Catalog",
      description: "Services page detailing mobile app development, CRM, POS, bulk SMS, and digital marketing.",
      userStories: ["As a visitor I can browse the Services page to see every offering"],
    },
  ],
};

test("buildAgentTask includes the spec's feature names, descriptions and user stories", () => {
  const task = buildAgentTask(PLAN_WITH_FEATURES, "preview");

  expect(task).toContain("Service & Product Catalog");
  expect(task).toContain("CRM");
  expect(task).toContain("bulk SMS");
  expect(task).toContain("As a visitor I can browse the Services page to see every offering");
});

test("buildAgentTask still works for a plan with no features (backward compatible)", () => {
  const task = buildAgentTask({ ...FIX_TEST_PLAN, features: [] }, "preview");
  expect(task).toContain("PROJECT:");
});
