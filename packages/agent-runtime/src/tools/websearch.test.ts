import { test, expect } from "bun:test";
import { execWebSearch } from "./websearch.ts";

test("execWebSearch rejects an empty query", async () => {
  const result = await execWebSearch({ query: "" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("query");
});

test("execWebSearch returns a result shape with status/summary/output", async () => {
  const result = await execWebSearch({ query: "does npm package left-pad exist" });
  expect(["success", "error"]).toContain(result.status);
  expect(typeof result.summary).toBe("string");
});
