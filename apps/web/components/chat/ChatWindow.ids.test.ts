import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-22 (found live on the Trailhead build): every planner question and plan showed twice. The user's message and
// the reply placeholder were both stamped Date.now() in the same millisecond, so they had the same ts; each update aimed
// at the reply (m.ts === assistantTs) overwrote the user's own bubble too, and both rendered under the same React key.
test("the reply placeholder never shares the user message's ts", () => {
  const src = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf-8");
  expect(src).toContain("const assistantTs = userMsg.ts + 1;");
  expect(src).not.toContain("const assistantTs = Date.now();");
});

// 2026-10-22 (found live): the planner first researches the product for several minutes and streams research_status and
// research_progress updates. The page ignored both, so a person saw only "..." with no sign anything was happening.
test("research updates are shown while the planner researches", () => {
  const src = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf-8");
  expect(src).toContain('chunk.type === "research_status"');
  expect(src).toContain('chunk.type === "research_progress"');
});

// An update can arrive split across two network reads (a question can carry a long signature). Decoding each read on its
// own and splitting on newlines dropped the split update silently. The unfinished last line is kept for the next read.
test("stream lines split across reads are joined before parsing", () => {
  const src = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf-8");
  expect(src).toContain("decoder.decode(value, { stream: true })");
  expect(src).toContain("pending = lines.pop() ?? \"\"");
});
