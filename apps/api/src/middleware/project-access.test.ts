import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { decideProjectAccess, projectIdFromPublicPath, ANON_OWNER } from "./project-access.ts";

// 2026-10-21 smoke test finding, fixed 2026-10-22: the build page's routes (status, plan, file tree, file contents, build
// plan, approve-spec, approve-deploy, chat history, live stream) were public so the page works before sign-in, which made
// the 12-character project id the only key: anyone holding a shared link could read a signed-in owner's code and approve its
// deploy. A project owned by a signed-in user now answers only to that user; anonymous projects stay open as before.

const OWNER = "3ca09e1a-2d62-4462-a9ae-64cc2691a19d";
const OTHER = "11111111-2222-3333-4444-555555555555";

test("the owner may use their project's public routes", () => {
  expect(decideProjectAccess(OWNER, OWNER)).toBe("allow");
});

test("anyone else, signed in or not, is told it does not exist", () => {
  expect(decideProjectAccess(OWNER, OTHER)).toBe("not_found");
  expect(decideProjectAccess(OWNER, null)).toBe("not_found");
});

test("a project made before sign-in stays open, and an unknown id is left to the route", () => {
  expect(decideProjectAccess(ANON_OWNER, null)).toBe("allow");
  expect(decideProjectAccess(ANON_OWNER, OTHER)).toBe("allow");
  expect(decideProjectAccess(null, null)).toBe("allow");
});

test("the project id is read from every public per-project path", () => {
  expect(projectIdFromPublicPath("/api/pipeline/88368631db38/status")).toBe("88368631db38");
  expect(projectIdFromPublicPath("/api/pipeline/88368631db38")).toBe("88368631db38");
  expect(projectIdFromPublicPath("/api/artifacts/88368631db38/tree")).toBe("88368631db38");
  expect(projectIdFromPublicPath("/api/artifacts/88368631db38/file")).toBe("88368631db38");
  expect(projectIdFromPublicPath("/api/artifacts/88368631db38/build-plan.json")).toBe("88368631db38");
  expect(projectIdFromPublicPath("/api/pipeline/88368631db38/approve-spec")).toBe("88368631db38");
  expect(projectIdFromPublicPath("/api/pipeline/88368631db38/approve-deploy")).toBe("88368631db38");
  expect(projectIdFromPublicPath("/api/chat/88368631db38")).toBe("88368631db38");
  expect(projectIdFromPublicPath("/ws/pipeline/88368631db38")).toBe("88368631db38");
  expect(projectIdFromPublicPath("/api/projects")).toBeNull();
  expect(projectIdFromPublicPath("/api/chat")).toBeNull();
});

test("the guard runs before the public routes are let through", () => {
  const src = readFileSync(new URL("../app.ts", import.meta.url), "utf-8");
  expect(src).toContain("projectAccessGuard");
  expect(src.indexOf('app.use("/ws/pipeline/*", projectAccessGuard)')).toBeGreaterThan(-1);
  expect(src.indexOf('app.use("/ws/pipeline/*", projectAccessGuard)')).toBeLessThan(src.indexOf('app.route("/ws", wsRouter)'));
});
