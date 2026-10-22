import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-22: the build page's planner chat decoded each network read on its own and split it on newlines. An update cut
// across two reads (a question with its long signature, or the research notes) failed to parse and was dropped silently,
// so the page could miss the planner's question or its research. The unfinished last line now waits for the next read.
test("the build page joins stream lines split across reads before parsing", () => {
  const src = readFileSync(new URL("./[id]/page.tsx", import.meta.url), "utf-8");
  expect(src).not.toContain("decoder.decode(value).split");
  expect(src).toContain("decoder.decode(value, { stream: true })");
  expect(src).toContain("pending = lines.pop() ?? \"\"");
});

// /chat was a second, older copy of the planner chat: styled with class names for a CSS library the platform does not
// have (so it rendered unstyled), linked from nowhere, and missing the research and question widgets of the real one.
// It now sends people to the real flow (Projects, New project, then the build page's chat).
test("/chat sends people to the real build flow", () => {
  const src = readFileSync(new URL("../chat/page.tsx", import.meta.url), "utf-8");
  expect(src).toContain('redirect("/projects")');
  expect(src).not.toContain("ChatWindow");
});
