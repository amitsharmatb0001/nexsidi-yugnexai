import { test, expect } from "bun:test";
import { projectsRouter } from "./projects.ts";

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
