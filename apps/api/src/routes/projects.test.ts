import { test, expect } from "bun:test";
import { projectsRouter, describeSettledStatus } from "./projects.ts";

// 2026-09-27: the customer-facing feature is "Express Build". The old
// /:id/clone route (and its clonedFrom fields) told customers their project
// started from someone else's; it no longer exists.

test("POST /express-build exists and validates its input before doing anything", async () => {
  const res = await projectsRouter.request("/express-build", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "name_required" });
});

test("the old clone route is gone", async () => {
  const res = await projectsRouter.request("/88d7b375eaef/clone", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "x" }),
  });
  expect(res.status).toBe(404);
});

// 2026-09-28 (Amit): the description is optional when creating a project —
// people often start with just a name and explain the app in the chat. It was
// required ("context_required"), which pushed people to type filler like "a".
test("validateNewProject accepts an empty description but still requires a name and caps the description length", async () => {
  const { validateNewProject } = await import("./projects.ts");
  expect(validateNewProject({ name: "Plantly", context: "" })).toEqual({ name: "Plantly", context: "" });
  expect(validateNewProject({ name: "Plantly" })).toEqual({ name: "Plantly", context: "" });
  expect(validateNewProject({ name: "  Plantly ", context: "  plants  " })).toEqual({ name: "Plantly", context: "plants" });
  expect(validateNewProject({ name: "", context: "x" })).toEqual({ error: "name_required" });
  expect(validateNewProject({ name: "P", context: "x".repeat(8001) })).toEqual({ error: "context_too_long" });
});

// 2026-10-22 (Trailhead Gear Rentals): a build that stopped for the owner's decision (status needs_review, after its
// deploy checks failed) was listed as "Queued...", as if it were waiting to start. Every stored status now has its own
// plain message, and a stop that needs the owner is marked as needing approval.
test("a build that stopped for a decision is not shown as queued", () => {
  const r = describeSettledStatus("needs_review");
  expect(r.stageMessage).not.toContain("Queued");
  expect(r.stageMessage).toBe("Stopped: needs your decision");
  expect(r.needsApproval).toBe(true);
  expect(r.stage).toBe("needs_review");
});

test("the other settled statuses keep their messages", () => {
  expect(describeSettledStatus("done").stageMessage).toBe("Your app is ready!");
  expect(describeSettledStatus("failed").stage).toBe("error");
  expect(describeSettledStatus("planning").stage).toBe("planning");
  expect(describeSettledStatus("queued").stageMessage).toBe("Queued...");
});
