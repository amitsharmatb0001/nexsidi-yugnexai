import { test, expect } from "bun:test";
import { decideByRules, targetOf, argsKeyOf, rewrittenPathsOf, contentPathsOf, type TriageCall } from "./triage-rules.ts";

const c = (key: string, name: string, args: Record<string, unknown>, o: Partial<TriageCall> = {}): TriageCall => ({
  key, callTurn: 0, callPart: 0, responseTurn: 1, responsePart: 0, name,
  argsKey: argsKeyOf(args), target: targetOf(name, args), rewrites: rewrittenPathsOf(name, args), contentPaths: contentPathsOf(name, args),
  resultChars: 100, isError: false, isStub: false, ...o,
});
const actions = (calls: TriageCall[]) => decideByRules(calls).map((d) => d.action);

test("argsKeyOf is key-order independent and keeps nested fields", () => {
  expect(argsKeyOf({ b: 1, a: { y: 2, x: 1 } })).toBe(argsKeyOf({ a: { x: 1, y: 2 }, b: 1 }));
  expect(argsKeyOf({ url: "u", headers: { auth: "1" } })).not.toBe(argsKeyOf({ url: "u", headers: { auth: "2" } }));
});

test("targetOf names what a call acts on", () => {
  expect(targetOf("read_file", { path: "a.ts" })).toBe("a.ts");
  expect(targetOf("run_command", { command: "npx tsc --noEmit" })).toBe("npx tsc --noEmit");
  expect(targetOf("http_request", { method: "POST", url: "http://localhost:3001/api/tasks" })).toBe("POST http://localhost:3001/api/tasks");
  expect(targetOf("docker_compose", { action: "logs", service: "backend" })).toBe("docker logs backend");
  expect(targetOf("docker_compose", { action: "up" })).toBe("docker up all");
  expect(targetOf("browser_screenshot", {})).toBeNull();
});

test("rewrittenPathsOf covers write_file, write_files and delete_file but not edit_file", () => {
  expect(rewrittenPathsOf("write_file", { path: "a", content: "x" })).toEqual(["a"]);
  expect(rewrittenPathsOf("write_files", { files: [{ path: "a", content: "x" }, { path: "b", content: "y" }] })).toEqual(["a", "b"]);
  expect(rewrittenPathsOf("delete_file", { path: "a" })).toEqual(["a"]);
  expect(rewrittenPathsOf("edit_file", { path: "a", old_str: "x", new_str: "y" })).toEqual([]);
});

test("exact repeat: older copy stubbed, newest kept", () => {
  expect(actions([c("1", "read_file", { path: "a" }), c("2", "read_file", { path: "a" })])).toEqual(["stub", "keep"]);
});

test("unresolved error kept; resolved error stubbed", () => {
  const err = c("1", "http_request", { method: "POST", url: "http://localhost:3001/api/tasks", body: "{}" }, { isError: true });
  const ok = c("2", "http_request", { method: "POST", url: "http://localhost:3001/api/tasks", body: "{\"title\":\"x\"}" });
  expect(actions([err])).toEqual(["keep"]);
  expect(actions([err, ok])).toEqual(["stub", "keep"]);
});

test("read_file stubbed when the file is rewritten later, kept when only edited", () => {
  expect(actions([c("1", "read_file", { path: "a" }), c("2", "write_file", { path: "a", content: "x" })])).toEqual(["stub", "keep"]);
  expect(actions([c("1", "read_file", { path: "a" }), c("2", "write_files", { files: [{ path: "a", content: "x" }] })])).toEqual(["stub", "keep"]);
  expect(actions([c("1", "read_file", { path: "a" }), c("2", "edit_file", { path: "a", old_str: "x", new_str: "y" })])).toEqual(["keep", "keep"]);
});

test("a failed newer read does not make the older successful read disposable", () => {
  expect(actions([c("1", "read_file", { path: "a" }), c("2", "read_file", { path: "a", encoding: "utf8" }, { isError: true })])).toEqual(["keep", "keep"]);
});

test("long docker/run_command logs truncated, short ones kept", () => {
  expect(actions([c("1", "docker_compose", { action: "logs" }, { resultChars: 50_000 })])).toEqual(["truncate"]);
  expect(actions([c("1", "run_command", { command: "npx tsc --noEmit" }, { resultChars: 200 })])).toEqual(["keep"]);
});

test("already-stubbed calls are left alone and never make an older full copy disposable", () => {
  expect(actions([c("1", "read_file", { path: "a" }, { isStub: true }), c("2", "read_file", { path: "a" })])).toEqual(["keep", "keep"]);
  expect(actions([c("1", "read_file", { path: "a" }), c("2", "read_file", { path: "a" }, { isStub: true })])).toEqual(["keep", "keep"]);
});

test("every decision carries the call key and a reason", () => {
  const d = decideByRules([c("k1", "read_file", { path: "a" }), c("k2", "read_file", { path: "a" })]);
  expect(d).toEqual([
    { key: "k1", action: "stub", reason: "same call repeated later" },
    { key: "k2", action: "keep", reason: "no newer copy" },
  ]);
});

// ── Superseded file content in call args (2026-09-27, approved by Amit) ──
// Replay showed generator agents' compacted middles are dominated by
// write_file/write_files content (46-93K tokens), which triage never shrank.
// Content of a file that is fully rewritten or deleted LATER is stale; the
// latest version of every file is kept verbatim.

test("contentPathsOf lists the files whose content a call carries", () => {
  expect(contentPathsOf("write_file", { path: "a", content: "x" })).toEqual(["a"]);
  expect(contentPathsOf("write_files", { files: [{ path: "a", content: "x" }, { path: "b", content: "y" }] })).toEqual(["a", "b"]);
  expect(contentPathsOf("edit_file", { path: "a", old_str: "x", new_str: "y" })).toEqual(["a"]);
  expect(contentPathsOf("read_file", { path: "a" })).toEqual([]);
});

const stubbedArgs = (calls: TriageCall[]) => decideByRules(calls).map((d) => d.stubArgPaths ?? []);

test("an older write of a file that is rewritten later has its content marked for stubbing; the latest is kept", () => {
  expect(stubbedArgs([c("1", "write_file", { path: "a", content: "v1" }), c("2", "write_file", { path: "a", content: "v2" })])).toEqual([["a"], []]);
});

test("write_files is stubbed only for the files rewritten later", () => {
  const calls = [c("1", "write_files", { files: [{ path: "a", content: "x" }, { path: "b", content: "y" }] }), c("2", "write_file", { path: "a", content: "z" })];
  expect(stubbedArgs(calls)).toEqual([["a"], []]);
});

test("edit_file content is stale once the file is fully rewritten, but a later edit does not make an older write stale", () => {
  expect(stubbedArgs([c("1", "edit_file", { path: "a", old_str: "x", new_str: "y" }), c("2", "write_file", { path: "a", content: "z" })])).toEqual([["a"], []]);
  expect(stubbedArgs([c("1", "write_file", { path: "a", content: "full" }), c("2", "edit_file", { path: "a", old_str: "x", new_str: "y" })])).toEqual([[], []]);
});

test("deleting a file makes its earlier content stale; a failed later write does not", () => {
  expect(stubbedArgs([c("1", "write_file", { path: "a", content: "x" }), c("2", "delete_file", { path: "a" })])).toEqual([["a"], []]);
  expect(stubbedArgs([c("1", "write_file", { path: "a", content: "x" }), c("2", "write_file", { path: "a", content: "y" }, { isError: true })])).toEqual([[], []]);
});

test("stubArgPaths is only present when there is something to stub", () => {
  const d = decideByRules([c("k1", "write_file", { path: "a", content: "v1" })]);
  expect(d).toEqual([{ key: "k1", action: "keep", reason: "no newer copy" }]);
});
