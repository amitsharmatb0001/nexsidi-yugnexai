import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateLiveFindings, runStage6, type Stage6Deps } from "./stage6-deployment.ts";
import type { Stage4Result } from "./stage4-multi-agent-dev.ts";

// 2026-10-24 (Brewline root cause): live rounds 6 and 7 sent "Navya's review did not complete" (a reviewer timeout) to
// the frontend builder as a CRITICAL app bug, twice, and model-written live findings went to builders unchecked (4 of 5
// in the last round were false). Now: a reviewer failure re-runs the review only; machine findings pass; model findings
// are fixed only when the Chief AI confirms them against the plan and the code.

const prevBuildDir = process.env.BUILD_DIR;
let root = "";
afterEach(() => {
  if (prevBuildDir === undefined) delete process.env.BUILD_DIR;
  else process.env.BUILD_DIR = prevBuildDir;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function project(id: string): void {
  root = mkdtempSync(join(tmpdir(), "live-gate-"));
  process.env.BUILD_DIR = root;
  const dir = join(root, id);
  mkdirSync(join(dir, "backend", "src"), { recursive: true });
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ successCriteria: ["Customers can place a pre-order"] }));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [{ method: "POST", path: "/api/v1/orders" }] }));
  writeFileSync(join(dir, "backend", "src", "app.ts"), 'app.use(cors({ origin: "http://localhost:3200" }));\n');
}

test("reviewer failures are taken out, machine findings pass, model findings follow the Chief AI's answer", async () => {
  project("p1");
  const retest = {
    pass: false,
    findings: [
      { file: "", issue: "[logic/CRITICAL] review-incomplete: Navya's review did not complete: AbortError" },
      { file: "frontend/app/page.tsx", issue: "[route-sweep] on a phone (375px wide), the page is 109px wider than the screen" },
      { file: "", issue: "overly permissive cors in `backend/src/app.ts`: `app.use(cors());`" },
      { file: "", issue: "placing an order returns 500" },
    ],
  };
  let prompt = "";
  const out = await gateLiveFindings("p1", retest, async (p) => {
    prompt = p;
    return JSON.stringify([
      { id: 1, verdict: "false", reason: "app.ts limits CORS to the frontend" },
      { id: 2, verdict: "fix", plan_item: "SC1", text: "POST /api/v1/orders returns 500 when an order is placed" },
    ]);
  });
  expect(prompt).toContain("GATE: quotes code that is in no project file");
  const issues = (out.findings as Array<{ issue: string }>).map((f) => f.issue);
  expect(issues).toEqual([
    "[route-sweep] on a phone (375px wide), the page is 109px wider than the screen",
    "[SC1] POST /api/v1/orders returns 500 when an order is placed",
  ]);
  expect(out.notChecked?.some((n) => n.includes("review did not finish"))).toBe(true);
  expect(out.pass).toBe(false);
  expect(out.reviewIncomplete).toBe(false);
});

test("when only a reviewer failed, the review runs again — no builder is called and nothing is redeployed", async () => {
  project("p2");
  let retests = 0;
  let deploys = 0;
  const fixes: string[] = [];
  const deps: Stage6Deps = {
    deployFn: async () => {
      deploys++;
      return { success: true, appUrl: "http://localhost:3200", backendUrl: "http://localhost:3300", githubRepo: null, errors: [] };
    },
    liveRetestFn: async () => {
      retests++;
      return retests === 1
        ? { pass: false, findings: [{ file: "", issue: "[logic/CRITICAL] review-incomplete: Navya's review did not complete: AbortError" }] }
        : { pass: true, findings: [] };
    },
    fixAanya: async () => { fixes.push("aanya"); return { success: true }; },
    fixShubham: async () => { fixes.push("shubham"); return { success: true }; },
    chiefChat: async () => "[]",
  };
  const stage4 = { success: true } as unknown as Stage4Result;
  const result = await runStage6("p2", stage4, deps, { projectId: "p2" } as never);
  expect(retests).toBe(2);
  expect(deploys).toBe(1);
  expect(fixes).toEqual([]);
  expect(result.success).toBe(true);
});
