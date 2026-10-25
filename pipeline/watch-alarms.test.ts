import { test, expect } from "bun:test";
import { alarmFor, AlarmThrottle } from "./watch-alarms.ts";

// 2026-10-25 (brewline2): I watched a build by stage changes only, so problems visible in the log (15 review calls each waiting
// the full 2 minutes, a 429 stopping a deploy, a check "not checked") were noticed late or only after the build stopped. This turns
// the failure patterns of a build log into alarm lines the moment they are written.

test("the failure patterns seen in the builds are alarms, with the numbers in them", () => {
  expect(alarmFor("[call-time:qa] karan gemini-3.8-flash FAILED in 120.0s: Error: AbortError")).toBe("ALARM review/model call FAILED after 120.0s: karan on gemini-3.8-flash");
  expect(alarmFor("[call-time:generation] aanya gemini-3.5-flash FAILED in 2.7s: 429")).toContain("FAILED after 2.7s");
  expect(alarmFor("[stage6] Auth smoke test: FAILED")).toBe("ALARM [stage6] Auth smoke test: FAILED");
  expect(alarmFor("[activity:escalate] project=abc reason=deploy_failed {")).toContain("ESCALATED to a human");
  expect(alarmFor("[riya] CRUD verification: not checked — orders: rejected the check's test values")).toContain("NOT CHECKED");
  expect(alarmFor("[stage6] Live retest failed (attempt 2 of 3) — starting agentic fix loop")).toContain("ALARM");
  expect(alarmFor("[qa-fix-loop] a reviewer did not finish — running the review again (1 of 2)")).toContain("ALARM");
  expect(alarmFor("[gemini:geminiChatWithTools] global returned 429 — retrying against fallback location")).toContain("429");
  expect(alarmFor("[stage6] TEST DATA LEFT IN THE DATABASE after the cleanup:")).toContain("ALARM");
  expect(alarmFor("budget_exceeded: project has spent $25.01 of its $25.00 cap")).toContain("ALARM");
});

test("ordinary progress lines are not alarms, and a timestamp in front does not hide an alarm", () => {
  expect(alarmFor("[call-time:qa] navya gemini-4-argon ok in 20.9s")).toBeNull();
  expect(alarmFor("[stage6] Route sweep: passed (40 page visits)")).toBeNull();
  expect(alarmFor("[aanya:gemini-agent] Tool call: write_file({\"path\":\"app/x.tsx\"})")).toBeNull();
  expect(alarmFor("02:09:07 [stage6] Auth smoke test: FAILED")).toBe("ALARM [stage6] Auth smoke test: FAILED");
});

test("the same alarm repeating is shown once with its count, so a failing loop is one clear message, not a flood", () => {
  let t = 0;
  const throttle = new AlarmThrottle(60_000, () => t);
  expect(throttle.offer("ALARM x")).toBe("ALARM x");
  t = 5_000;
  expect(throttle.offer("ALARM x")).toBeNull();
  t = 9_000;
  expect(throttle.offer("ALARM x")).toBeNull();
  expect(throttle.offer("ALARM y")).toBe("ALARM y");
  t = 70_000;
  expect(throttle.offer("ALARM x")).toBe("ALARM x (3 times in the last minute)");
});

// 2026-10-25 (brewline3): the backend builder wrote "[blocked] ... I cannot modify db/migrations myself" at 11:20 and was refused
// finishing 14 more times; the first alarm came at 11:30 when the build escalated. A builder reporting it is blocked, or a finish
// refused by the system's checks, is raised at once.
test("a builder reporting it is blocked, and a refused finish, are alarms at once", () => {
  expect(alarmFor("11:20:06 [blocked] shubham -> pranav: order_items.menu_item_id uses ON DELETE CASCADE")).toContain("BLOCKED");
  expect(alarmFor("11:19:09 [shubham:gemini-agent] task_complete REJECTED on iteration 27: 2 problem(s) found by the system's own checks")).toContain("finish REFUSED");
});
