import { test, expect } from "bun:test";
import type { GeminiMessage } from "@nexsidi/llm-client";
import { collectCalls, triageMiddle } from "./triage-compaction.ts";
import { findGeminiPairingViolations } from "./history-validate.ts";
import { estimateGeminiTokenCount } from "./compaction.ts";

const turn = (name: string, args: Record<string, unknown>, response: Record<string, unknown>, extra: { signature?: string; image?: boolean } = {}): GeminiMessage[] => [
  {
    role: "model",
    content: [
      ...(extra.signature ? [{ thought: true as const, thoughtSignature: extra.signature }] : []),
      { functionCall: { name, args }, ...(extra.signature ? { thoughtSignature: extra.signature } : {}) },
    ],
  },
  {
    role: "user",
    content: [
      { functionResponse: { name, response } },
      ...(extra.image ? [{ inlineData: { mimeType: "image/png", data: "iVBORw0KGgo".repeat(50) } }] : []),
    ],
  },
];

const middle: GeminiMessage[] = [
  ...turn("read_file", { path: "a.ts" }, { status: "success", output: "A1" }, { signature: "sig-1" }),
  ...turn("http_request", { method: "POST", url: "http://localhost:3001/api/tasks" }, { status: "error", summary: "500 Internal Server Error" }),
  ...turn("browser_screenshot", {}, { status: "success", summary: "saved" }, { image: true }),
  ...turn("docker_compose", { action: "logs" }, { status: "success", output: "x".repeat(20_000) }),
  ...turn("read_file", { path: "a.ts" }, { status: "success", output: "A2" }),
];

test("collectCalls pairs each functionCall with its functionResponse", () => {
  const calls = collectCalls(middle);
  expect(calls.map((c) => [c.name, c.callTurn, c.responseTurn, c.responsePart])).toEqual([
    ["read_file", 0, 1, 0], ["http_request", 2, 3, 0], ["browser_screenshot", 4, 5, 0], ["docker_compose", 6, 7, 0], ["read_file", 8, 9, 0],
  ]);
  expect(calls[1]!.isError).toBe(true);
  expect(calls[1]!.target).toBe("POST http://localhost:3001/api/tasks");
});

test("triageMiddle keeps every turn and every call/response pair", () => {
  const { turns } = triageMiddle(middle, 1_000_000);
  expect(turns.length).toBe(middle.length);
  expect(findGeminiPairingViolations(turns)).toEqual([]);
});

test("triageMiddle stubs the superseded read, keeps the unresolved error verbatim, truncates the long log", () => {
  const { turns, stats } = triageMiddle(middle, 1_000_000);
  const response = (i: number) => (turns[i]!.content as Array<{ functionResponse?: { response: Record<string, unknown> } }>)[0]!.functionResponse!.response;
  expect(response(1)).toEqual({ status: "success", compacted: true, summary: expect.stringContaining("[result omitted during compaction: same call repeated later; read_file a.ts;") });
  expect(response(3)).toEqual({ status: "error", summary: "500 Internal Server Error" });
  expect(String(response(7).output).length).toBeLessThan(4_000);
  expect(String(response(7).output)).toContain("chars truncated");
  expect(response(9)).toEqual({ status: "success", output: "A2" });
  expect(stats).toMatchObject({ calls: 5, stubbed: 1, truncated: 1, kept: 3 });
});

test("thought parts and thoughtSignatures are untouched", () => {
  const { turns } = triageMiddle(middle, 1_000_000);
  expect(turns[0]).toEqual(middle[0]!);
});

test("screenshots in the middle become a short text placeholder", () => {
  const { turns } = triageMiddle(middle, 1_000_000);
  const parts = turns[5]!.content as Array<Record<string, unknown>>;
  expect(parts.some((p) => "inlineData" in p)).toBe(false);
  expect(parts[1]).toEqual({ text: "[earlier screenshot omitted — image/png, already reviewed in a previous turn]" });
});

test("triageMiddle is idempotent", () => {
  const once = triageMiddle(middle, 1_000_000).turns;
  expect(triageMiddle(once, 1_000_000).turns).toEqual(once);
});

test("the budget is enforced by stubbing oldest non-error results first, errors last", () => {
  const big: GeminiMessage[] = [];
  for (let i = 0; i < 150; i++) big.push(...turn("http_request", { method: "GET", url: `http://localhost:3001/api/items/${i}` }, { status: "success", output: "y".repeat(8_000) }));
  big.splice(2, 0, ...turn("http_request", { method: "POST", url: "http://localhost:3001/api/tasks" }, { status: "error", summary: "500" }));
  expect(estimateGeminiTokenCount(big)).toBeGreaterThan(290_000);

  const { turns, stats } = triageMiddle(big, 40_000);
  expect(stats.tokensAfter).toBeLessThanOrEqual(40_000);
  expect(estimateGeminiTokenCount(turns)).toBe(stats.tokensAfter);
  expect(findGeminiPairingViolations(turns)).toEqual([]);
  const errorResponse = (turns[3]!.content as Array<{ functionResponse?: { response: Record<string, unknown> } }>)[0]!.functionResponse!.response;
  expect(errorResponse).toEqual({ status: "error", summary: "500" }); // the unresolved error survives the budget
  const lastResponse = (turns[turns.length - 1]!.content as Array<{ functionResponse?: { response: Record<string, unknown> } }>)[0]!.functionResponse!.response;
  expect(lastResponse.compacted).toBeUndefined(); // newest results are the last to go
});

// 2026-09-27: unresolved errors are what triage exists to keep, so the budget
// never stubs them (it used to, last). If they alone don't fit, the caller's
// fallback drops other whole turns instead (context-selection.ts).
test("a zero budget stubs every result except the unresolved error, and keeps the pairs", () => {
  const { turns, stats } = triageMiddle(middle, 0);
  expect(stats.stubbed).toBe(4);
  const errorResponse = (turns[3]!.content as Array<{ functionResponse?: { response: Record<string, unknown> } }>)[0]!.functionResponse!.response;
  expect(errorResponse).toEqual({ status: "error", summary: "500 Internal Server Error" });
  expect(findGeminiPairingViolations(turns)).toEqual([]);
});

// ── Superseded file content in call args (2026-09-27) ────────────────────
const writes: GeminiMessage[] = [
  ...turn("write_file", { path: "src/app.ts", content: "v1 ".repeat(5_000) }, { status: "success", summary: "written" }, { signature: "sig-w1" }),
  ...turn("write_files", { files: [{ path: "src/app.ts", content: "v2 ".repeat(5_000) }, { path: "src/db.ts", content: "db ".repeat(5_000) }] }, { status: "success", summary: "written" }),
  ...turn("edit_file", { path: "src/db.ts", old_str: "db", new_str: "database" }, { status: "success", summary: "edited" }),
  ...turn("write_file", { path: "src/app.ts", content: "v3 final" }, { status: "success", summary: "written" }),
];
const callArgs = (turns: GeminiMessage[], i: number) => (turns[i]!.content as Array<{ functionCall?: { args: Record<string, unknown> } }>).find((p) => p.functionCall)!.functionCall!.args;

test("content of a file rewritten later is replaced by a one-line note; the latest content stays verbatim", () => {
  const { turns, stats } = triageMiddle(writes, 1_000_000);
  expect(String(callArgs(turns, 0).content)).toStartWith("[content omitted during compaction: src/app.ts was rewritten later; 15000 chars]");
  const files = callArgs(turns, 2).files as Array<{ path: string; content: string }>;
  expect(files[0]!.content).toStartWith("[content omitted during compaction: src/app.ts");
  expect(files[1]!.content).toBe("db ".repeat(5_000)); // src/db.ts is only edited later, never rewritten
  expect(callArgs(turns, 4)).toEqual({ path: "src/db.ts", old_str: "db", new_str: "database" });
  expect(callArgs(turns, 6)).toEqual({ path: "src/app.ts", content: "v3 final" });
  expect(stats.argsStubbed).toBe(2);
  expect(stats.tokensAfter).toBeLessThan(stats.tokensBefore / 2);
  expect(findGeminiPairingViolations(turns)).toEqual([]);
});

test("stubbing call args keeps the functionCall's thoughtSignature and the thought part", () => {
  const { turns } = triageMiddle(writes, 1_000_000);
  const parts = turns[0]!.content as Array<Record<string, unknown>>;
  expect(parts[0]).toEqual({ thought: true, thoughtSignature: "sig-w1" });
  expect(parts[1]!.thoughtSignature).toBe("sig-w1");
});

test("stubbing call args is idempotent", () => {
  const once = triageMiddle(writes, 1_000_000).turns;
  expect(triageMiddle(once, 1_000_000).turns).toEqual(once);
});
