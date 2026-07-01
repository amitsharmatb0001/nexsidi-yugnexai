import { test, expect } from "bun:test";
import { execScreenshot } from "./screenshot.ts";

test("execScreenshot blocks non-localhost URLs (same policy as http_request)", async () => {
  const result = await execScreenshot({ url: "https://example.com", outputPath: "shot.png" });
  expect(result.status).toBe("error");
  expect(result.summary).toContain("localhost");
});

test("execScreenshot rejects a path traversal attempt in outputPath", async () => {
  const result = await execScreenshot({ url: "http://localhost:3200", outputPath: "../../etc/shot.png" });
  expect(result.status).toBe("error");
});
