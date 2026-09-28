import { test, expect } from "bun:test";
import { newProjectError } from "./new-project.ts";

// 2026-09-28 (Amit): the "What are you building?" box is optional — a name is
// enough to create a project; the app gets described in the chat.
test("a project needs a name but not a description", () => {
  expect(newProjectError("Plantly", "")).toBeNull();
  expect(newProjectError("Plantly", "   ")).toBeNull();
  expect(newProjectError("  ", "a plant tracker")).toBe("Give the project a name.");
});
