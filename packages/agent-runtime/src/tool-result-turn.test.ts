import { test, expect } from "bun:test";
import { splitToolResultTurn } from "./tool-result-turn.ts";

// 2026-10-05 (Ledgerly run 4, final review): probed live — gemini-3.6, 3.7 and 3.8-flash answer 400 "Requests
// ending with a model turn are not supported" when the turn holding a functionResponse also carries a screenshot
// or a text notice; only 3.5-flash accepts it. Every screenshot and every step notice therefore failed on the
// newer models (a wasted failing call each time) and left 3.5 as the only model that could serve the run — when
// it timed out, the whole review looped. A separate user turn after the functionResponse turn is accepted by all four.
const fr = { functionResponse: { name: "browser_screenshot", response: { status: "success" } } };
const img = { inlineData: { mimeType: "image/png", data: "AAAA" } };

test("a tool result alone stays one turn", () => {
  expect(splitToolResultTurn([fr])).toEqual([{ role: "user", content: [fr] }]);
});

test("a screenshot and notices go in a separate user turn after the function responses", () => {
  const out = splitToolResultTurn([fr, img, { text: "5 steps left" }]);
  expect(out).toEqual([
    { role: "user", content: [fr] },
    { role: "user", content: [img, { text: "5 steps left" }] },
  ]);
});

test("several function responses stay together in the first turn", () => {
  const fr2 = { functionResponse: { name: "http_request", response: {} } };
  const out = splitToolResultTurn([fr, fr2, { text: "note" }]);
  expect(out[0]).toEqual({ role: "user", content: [fr, fr2] });
  expect(out[1]).toEqual({ role: "user", content: [{ text: "note" }] });
});

test("a turn with no function response is left as it is", () => {
  expect(splitToolResultTurn([{ text: "just text" }])).toEqual([{ role: "user", content: [{ text: "just text" }] }]);
});
