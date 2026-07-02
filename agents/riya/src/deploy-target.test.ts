import { test, expect } from "bun:test";
import { resolveDeployTarget } from "./index.ts";

test("resolveDeployTarget local returns docker-compose config", () => {
  const config = resolveDeployTarget("local");
  expect(config.mode).toBe("docker-compose");
});

test("resolveDeployTarget gcp is explicitly not-yet-implemented, not a silent fallback", () => {
  expect(() => resolveDeployTarget("gcp")).toThrow("GCP deploy target not yet implemented");
});
