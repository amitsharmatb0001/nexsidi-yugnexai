import { test, expect } from "bun:test";
import { BrowserToolset, BROWSER_TOOL_NAMES, BROWSER_TOOL_DEFS } from "./browser.ts";

// These hit the security guards, which run BEFORE the lazy session is spawned,
// so no Node worker / Chromium / running app is needed.

test("browser_navigate blocks non-localhost URLs (no worker spawned)", async () => {
  const ts = new BrowserToolset();
  const r = await ts.exec("browser_navigate", { url: "https://evil.example.com" });
  expect(r.status).toBe("error");
  expect(r.summary).toContain("localhost");
  await ts.close();
});

test("browser_navigate rejects a malformed URL", async () => {
  const ts = new BrowserToolset();
  const r = await ts.exec("browser_navigate", { url: "not a url" });
  expect(r.status).toBe("error");
  await ts.close();
});

test("browser_screenshot rejects an outputPath that escapes cwd", async () => {
  const ts = new BrowserToolset();
  const r = await ts.exec("browser_screenshot", { outputPath: "../../etc/x.png" });
  expect(r.status).toBe("error");
  expect(r.summary).toContain("escapes the working directory");
  await ts.close();
});

test("BROWSER_TOOL_NAMES matches the tool defs exactly", () => {
  const defNames = new Set(BROWSER_TOOL_DEFS.map((d) => d.function.name));
  expect(defNames).toEqual(BROWSER_TOOL_NAMES);
});
