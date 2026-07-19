import { expect, test } from "bun:test";
import { transitionWorkspace } from "./state-machine.ts";

test("allows plan approval but rejects a direct intake-to-building jump", () => {
  expect(transitionWorkspace("plan_ready", "approved")).toBe("approved");
  expect(() => transitionWorkspace("intake", "building")).toThrow(
    "invalid_workspace_transition",
  );
});
