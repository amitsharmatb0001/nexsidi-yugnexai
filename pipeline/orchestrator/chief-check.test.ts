import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planItemsFor, planSection, chiefCheck, isMachineFinding, isReviewerFailure, type ChiefChat } from "./chief-check.ts";

// 2026-10-24 (Brewline root cause): 30% of the 53 findings were outside the approved plan (an "admin" role the spec does
// not have, performance nits for one coffee shop) and 6% contradicted the code, yet every one started a paid fix round;
// the Chief AI only looked at a finding when a builder disputed it. Now every model-written finding is checked against
// the approved plan and the real code in ONE call per round before anything is fixed. Machine checks (page sweep, colour
// check, emoji, dead button) are already proven and skip it; a reviewer's own failure is never an app finding.

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function project(): string {
  dir = mkdtempSync(join(tmpdir(), "chief-"));
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ successCriteria: ["Customers can place a pre-order", "Staff can update order status"] }));
  writeFileSync(join(dir, "api-contract.json"), JSON.stringify({ endpoints: [
    { method: "POST", path: "/api/v1/orders", description: "Place an order" },
    { method: "PATCH", path: "/api/v1/orders/:id/status", description: "Update status (staff only)" },
  ] }));
  writeFileSync(join(dir, "build-plan.json"), JSON.stringify({ designBrief: { palette: [{ name: "oat", hex: "#FAF6F0" }], typography: { display: "Fraunces", body: "Plus Jakarta Sans" } } }));
  mkdirSync(join(dir, "backend", "src"), { recursive: true });
  writeFileSync(join(dir, "backend", "src", "app.ts"), 'app.use(cors({ origin: "http://localhost:3200" }));\n');
  return dir;
}

test("the plan items come from the approved spec, contract, roles, design and the fixed security baseline", () => {
  const items = planItemsFor(project());
  expect(items.map((i) => i.id)).toEqual(expect.arrayContaining(["SC1", "SC2", "EP1", "EP2", "ROLES", "DESIGN", "SEC1"]));
  expect(items.find((i) => i.id === "ROLES")!.text).toContain("staff");
  expect(items.find((i) => i.id === "DESIGN")!.text).toContain("#FAF6F0");
  const section = planSection(dir);
  expect(section).toContain("[SC1] Customers can place a pre-order");
  expect(section).toContain("[EP2] PATCH /api/v1/orders/:id/status");
});

test("one call decides every finding: fix (with its plan item), later, or false; the code of cited files is sent", async () => {
  project();
  let prompt = "";
  let calls = 0;
  const chat: ChiefChat = async (p) => {
    calls++;
    prompt = p;
    return JSON.stringify([
      { id: 1, verdict: "fix", plan_item: "SC2", text: "Staff cannot move an order to ready: ...", reason: "breaks SC2" },
      { id: 2, verdict: "later", plan_item: "", text: "", reason: "an admin role is not in the plan" },
      { id: 3, verdict: "false", plan_item: "", text: "", reason: "app.ts limits CORS to http://localhost:3200" },
    ]);
  };
  const out = await chiefCheck(dir, [
    { text: "staff status update fails" },
    { text: "admin is locked out of /staff" },
    { text: "backend/src/app.ts uses `app.use(cors());`", flag: "quotes code that is in no project file" },
  ], chat);
  expect(calls).toBe(1);
  expect(prompt).toContain("[SC2] Staff can update order status");
  expect(prompt).toContain('app.use(cors({ origin: "http://localhost:3200" }));'); // the real code of the cited file
  expect(prompt).toContain("quotes code that is in no project file");
  expect(out.fix.map((f) => f.text)).toEqual(["[SC2] Staff cannot move an order to ready: ..."]);
  expect(out.later.length).toBe(1);
  expect(out.notTrue.length).toBe(1);
  expect(readFileSync(join(dir, "later.jsonl"), "utf-8")).toContain("admin is locked out");
  expect(readFileSync(join(dir, "settled-not-true.jsonl"), "utf-8")).toContain("app.use(cors());");
});

test("a 'fix' that names no real plan item is treated as later; an unanswered finding is kept", async () => {
  project();
  const chat: ChiefChat = async () => JSON.stringify([{ id: 1, verdict: "fix", plan_item: "SC99", text: "x", reason: "" }]);
  const out = await chiefCheck(dir, [{ text: "a" }, { text: "b" }], chat);
  expect(out.later.map((f) => f.text)).toEqual(["a"]);
  expect(out.fix.map((f) => f.text)).toEqual(["b"]);
});

test("if the check itself fails, every finding is kept (nothing real is lost)", async () => {
  project();
  const out = await chiefCheck(dir, [{ text: "a" }, { text: "b", flag: "cites files that do not exist" }], async () => {
    throw new Error("model down");
  });
  expect(out.fix.map((f) => f.text)).toEqual(["a", "b"]);
  expect(out.checked).toBe(false);
  expect(existsSync(join(dir, "later.jsonl"))).toBe(false);
});

test("machine findings skip the check and a reviewer's own failure is recognised", () => {
  expect(isMachineFinding("[route-sweep] on a phone (375px wide) ...")).toBe(true);
  expect(isMachineFinding("[spec-compliance] spec explicitly specifies color #faf6f0")).toBe(true);
  expect(isMachineFinding("[emoji-ui] emoji are used as ui graphics")).toBe(true);
  expect(isMachineFinding("broken footer logo image")).toBe(false);
  expect(isReviewerFailure("[logic/CRITICAL] review-incomplete: Navya's review did not complete: AbortError")).toBe(true);
  expect(isReviewerFailure("stopped: the step was cancelled or timed out (not_found) — progress saved for a retry")).toBe(true);
  expect(isReviewerFailure("aborted early: hit an unrecoverable error (auth failure or permission denied)")).toBe(true);
  expect(isReviewerFailure("the sign-in page does not complete the redirect")).toBe(false);
});

test("Brewline's recorded round 11 through the proof gate and the check: only what the Chief AI confirms is fixed", async () => {
  dir = mkdtempSync(join(tmpdir(), "chief-r11-"));
  cpSync(join(import.meta.dir, "__fixtures__", "finding-proof", "r11"), dir, { recursive: true });
  writeFileSync(join(dir, "spec.json"), JSON.stringify({ successCriteria: ["Visitors can browse the menu"] }));
  const findings = (JSON.parse(readFileSync(join(import.meta.dir, "__fixtures__", "finding-proof", "findings.json"), "utf-8")) as { r11: string[] }).r11;
  let sent: Array<{ id: number; flag?: string }> = [];
  const chat: ChiefChat = async (p) => {
    sent = [...p.matchAll(/^FINDING (\d+)(?: — GATE: (.*))?$/gm)].map((m) => ({ id: Number(m[1]), flag: m[2] }));
    return JSON.stringify(sent.map((s) => ({ id: s.id, verdict: s.flag ? "false" : "later", plan_item: "", text: "", reason: s.flag ?? "" })));
  };
  const { prepareForChief } = await import("./chief-check.ts");
  const prepared = prepareForChief(dir, findings);
  expect(prepared.filter((f) => f.flag).length).toBe(5); // all five of round 11 carry the gate's proof of a falsehood
  const out = await chiefCheck(dir, prepared, chat);
  expect(sent.length).toBe(5);
  expect(out.fix.length).toBe(0);
});
