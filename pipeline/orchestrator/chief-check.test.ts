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
  expect(isMachineFinding("[map-rule INT1] db/migrations/0000.sql:1 — order_items keeps no copy of menu_items.name")).toBe(true);
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

// 2026-10-25 (brewline2): the reviewers reported "sign-up accepts a role from the request" (CRITICAL, privilege escalation) and
// "deleting a menu item deletes the order lines of past orders" (CRITICAL, data loss). The Chief AI filed both under "later":
// the spec's own wording allowed a staff sign-up, and no plan item said that history must survive. The delivered app still
// has both. A plan cannot authorise a vulnerability, and every app keeps what its history recorded: both are now fixed items
// of the yardstick, and the Chief is told a security flaw is never "later" because the plan allowed it.
test("the yardstick names the two rules the plan never stated: no self-chosen role, and history survives deleting a catalog item", () => {
  const items = planItemsFor(project());
  const sec = items.filter((i) => i.id.startsWith("SEC")).map((i) => i.text).join(" | ");
  expect(sec).toContain("ever lets the caller choose a role");
  const integrity = items.filter((i) => i.id.startsWith("INT"));
  expect(integrity.length).toBe(3);
  expect(integrity.map((i) => i.text).join(" | ")).toContain("eleting or editing a record");
  expect(integrity.map((i) => i.text).join(" | ")).toContain("price");
  expect(planSection(dir)).toContain("[INT1]");
});

test("the Chief is told a security flaw or lost history is a fix even when the plan's wording allowed it", async () => {
  project();
  let prompt = "";
  await chiefCheck(dir, [{ text: "`backend/src/routes/auth.ts` [security/CRITICAL] Privilege Escalation: sign-up accepts a role from the body" }], async (p) => {
    prompt = p;
    return JSON.stringify([{ id: 1, verdict: "fix", plan_item: "SEC9", text: "sign-up accepts a role", reason: "SEC9" }]);
  });
  expect(prompt.replace(/\s+/g, " ")).toContain("never \"later\" because the plan's own wording allowed it");
  expect(prompt).toContain("INT1");
});

// 2026-10-25 (brewline3): the check cut every file at 8,000 characters, so a finding about line 296 of a 500-line file was judged on
// its first 150 lines, answered "cut off, cannot confirm", and was dismissed as NOT TRUE; one of those dismissals was a genuine
// problem. Now it is shown the cited lines (and the whole file when it is small), and a finding is only ruled not true when
// the Chief AI quotes the code that contradicts it.
function longProject(): string {
  const d = project();
  const lines: string[] = [];
  for (let i = 1; i <= 600; i++) lines.push(i === 296 ? "  const MARKER_LINE_296 = await pool.query('SELECT mi.name FROM menu_items mi');" : `  const filler_${i} = ${i}; // padding so this file is much longer than the old cut`);
  writeFileSync(join(d, "backend", "src", "orders.ts"), lines.join("\n") + "\n");
  return d;
}

test("a finding about line 296 of a long file is shown line 296 with its line number, not the first 8,000 characters", async () => {
  longProject();
  let prompt = "";
  const chat: ChiefChat = async (p) => {
    prompt = p;
    return JSON.stringify([{ id: 1, verdict: "later", reason: "x" }]);
  };
  await chiefCheck(dir, [{ text: "backend/src/orders.ts:296 — [logic/HIGH] the name is read through a join" }], chat);
  expect(prompt).toContain("MARKER_LINE_296");
  expect(prompt).toMatch(/296\|/);
  expect(prompt.length).toBeLessThan(120_000);
});

test("a 'false' without a quote of the contradicting code is not accepted: the finding is kept and goes to a builder to confirm", async () => {
  longProject();
  const chat: ChiefChat = async () => JSON.stringify([{ id: 1, verdict: "false", reason: "the code is cut off, so the claim cannot be confirmed" }]);
  const out = await chiefCheck(dir, [{ text: "backend/src/orders.ts:296 — [logic/HIGH] reads the name through a join" }], chat);
  expect(out.notTrue).toEqual([]);
  expect(out.fix.length).toBe(1);
  expect(existsSync(join(dir, "settled-not-true.jsonl"))).toBe(false);
});

test("a 'false' with a quote that really is in the cited file is accepted; a quote that is not there is not", async () => {
  longProject();
  const ok: ChiefChat = async () => JSON.stringify([{ id: 1, verdict: "false", quote: "const filler_10 = 10;", reason: "line 10 shows it" }]);
  const accepted = await chiefCheck(dir, [{ text: "backend/src/orders.ts:10 — [logic/HIGH] claims something about filler_10" }], ok);
  expect(accepted.notTrue.length).toBe(1);
  const invented: ChiefChat = async () => JSON.stringify([{ id: 1, verdict: "false", quote: "WHERE oi.price = 0 AND this text is not in the file", reason: "r" }]);
  const refused = await chiefCheck(dir, [{ text: "backend/src/orders.ts:11 — [logic/HIGH] another claim" }], invented);
  expect(refused.notTrue).toEqual([]);
  expect(refused.fix.length).toBe(1);
});

test("a finding the proof gate already found false needs no quote (the system proved it)", async () => {
  project();
  const chat: ChiefChat = async () => JSON.stringify([{ id: 1, verdict: "false", reason: "no such code" }]);
  const out = await chiefCheck(dir, [{ text: "backend/src/app.ts uses `app.use(cors());`", flag: "quotes code that is in no project file" }], chat);
  expect(out.notTrue.length).toBe(1);
});

test("the Chief is told to quote the code for a 'false' and that 'cannot see' is not 'false'", async () => {
  project();
  let prompt = "";
  await chiefCheck(dir, [{ text: "backend/src/app.ts:1 — x" }], async (p) => { prompt = p; return "[]"; });
  expect(prompt).toContain('"quote"');
  expect(prompt).toMatch(/cannot see|cannot confirm/i);
});

test("the yardstick also names three rules the reviewers kept finding outside the plan: no secrets in logs, no internal brief shown, one set of business-rule numbers", () => {
  const text = planSection(project());
  expect(text).toMatch(/log/i);
  expect(text).toMatch(/brief|spec/i);
  expect(text).toMatch(/opening hours|business rule/i);
});

// 2026-10-29 (team plan, stage 2): an answer given during the build (tools/ask.ts) is part of the yardstick, so the
// reviewers judge the code against the customer's answer, and the builders' finish checklist names it too.
test("answers given during the build are plan items the reviewers and builders check against", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { planItemsFor } = await import("./chief-check.ts");
  const { checklistFor } = await import("./stages/builder-exit-checks.ts");
  const dir = mkdtempSync(join(tmpdir(), "ans-items-"));
  try {
    writeFileSync(join(dir, "build-answers.jsonl"), JSON.stringify({ question: "What are the store hours?", answer: "Mon–Sat 7:00–18:00", source: "customer", askedBy: "shubham", at: "t" }) + "\n");
    const ans = planItemsFor(dir).find((i) => i.id === "ANS1");
    expect(ans?.text).toContain("Mon–Sat 7:00–18:00");
    expect(checklistFor(dir, "backend").some((i) => i.id === "ANS1")).toBe(true);
    expect(checklistFor(dir, "frontend").some((i) => i.id === "ANS1")).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
