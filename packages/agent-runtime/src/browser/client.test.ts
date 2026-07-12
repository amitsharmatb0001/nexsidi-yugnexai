import { test, expect } from "bun:test";
import { drainJsonLines } from "./client.ts";

test("drainJsonLines parses one complete line and returns empty leftover", () => {
  const got: unknown[] = [];
  const leftover = drainJsonLines('{"id":1,"ok":true}\n', (m) => got.push(m));
  expect(got).toEqual([{ id: 1, ok: true }]);
  expect(leftover).toBe("");
});

test("drainJsonLines parses multiple lines in one chunk", () => {
  const got: unknown[] = [];
  drainJsonLines('{"id":1,"ok":true}\n{"id":2,"ok":false,"error":"x"}\n', (m) => got.push(m));
  expect(got).toEqual([{ id: 1, ok: true }, { id: 2, ok: false, error: "x" }]);
});

test("drainJsonLines holds a partial line as leftover until its newline arrives", () => {
  const got: unknown[] = [];
  const leftover = drainJsonLines('{"id":1,', (m) => got.push(m));
  expect(got).toEqual([]);
  expect(leftover).toBe('{"id":1,');
  drainJsonLines(leftover + '"ok":true}\n', (m) => got.push(m));
  expect(got).toEqual([{ id: 1, ok: true }]);
});

test("drainJsonLines ignores blank lines and non-JSON noise without throwing", () => {
  const got: unknown[] = [];
  const leftover = drainJsonLines('\ngarbage not json\n{"id":3,"ok":true}\n', (m) => got.push(m));
  expect(got).toEqual([{ id: 3, ok: true }]);
  expect(leftover).toBe("");
});
