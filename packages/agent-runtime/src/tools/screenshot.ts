import { chromium } from "playwright";
import { resolve } from "path";
import type { NimToolDef } from "@nexsidi/llm-client";
import type { ToolResult } from "./file.ts";

export async function execScreenshot(args: { url: string; outputPath: string }): Promise<ToolResult> {
  const parsed = new URL(args.url);
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return { status: "error", summary: `screenshot blocked: only localhost allowed, got '${parsed.hostname}'` };
  }
  const outAbs = resolve(args.outputPath);
  const cwdAbs = resolve(process.cwd());
  if (!outAbs.startsWith(cwdAbs)) {
    return { status: "error", summary: "screenshot outputPath escapes the working directory" };
  }

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(args.url, { timeout: 15_000, waitUntil: "networkidle" });
    await page.screenshot({ path: outAbs, fullPage: true });
    return { status: "success", summary: `Screenshot saved to ${args.outputPath}`, output: outAbs };
  } catch (err) {
    return { status: "error", summary: `screenshot failed: ${String(err)}` };
  } finally {
    await browser?.close();
  }
}

export const SCREENSHOT_TOOL_DEF: NimToolDef = {
  type: "function",
  function: {
    name: "screenshot",
    description: "Take a screenshot of a running localhost app for visual QA review (padding, layout, broken CSS). Use before judging any visual claim.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Localhost URL to screenshot" },
        outputPath: { type: "string", description: "Relative path to save the PNG" },
      },
      required: ["url", "outputPath"],
    },
  },
};
