import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeSnapshot, latestSnapshot, restoreSnapshot, stageHandoffFile } from "./snapshot.ts";
import { hashContext, canonicalize } from "./hash.ts";
import { createHash } from "node:crypto";

// Patent claim 3(d) and 1(c): a transactional handoff — atomic transfer with rollback capability. A handoff either happens
// completely or not at all, and when a handoff turns out to be corrupt the project's files go back to the last good state.

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function project(): string {
  dir = mkdtempSync(join(tmpdir(), "nexsidi-snap-"));
  mkdirSync(join(dir, "backend", "src"), { recursive: true });
  mkdirSync(join(dir, "frontend", "app"), { recursive: true });
  mkdirSync(join(dir, "backend", "node_modules", "dep"), { recursive: true });
  mkdirSync(join(dir, "frontend", ".next"), { recursive: true });
  writeFileSync(join(dir, "backend", "src", "app.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "frontend", "app", "page.tsx"), "export default function P() { return null; }\n");
  writeFileSync(join(dir, "backend", "node_modules", "dep", "index.js"), "heavy");
  writeFileSync(join(dir, "frontend", ".next", "cache.bin"), "cache");
  writeFileSync(join(dir, "spec.json"), '{"name":"A"}');
  writeFileSync(join(dir, "history-agent.json"), "[]"); // pipeline bookkeeping: never part of the project's files
  return dir;
}

test("a snapshot copies the project's own files and leaves out dependencies, build output and agent histories", () => {
  const d = project();
  const s = takeSnapshot(d, "arjun-shubham")!;
  const snapDir = join(d, ".nexsidi", "snapshots", s.id, "files");
  expect(existsSync(join(snapDir, "backend", "src", "app.ts"))).toBe(true);
  expect(existsSync(join(snapDir, "spec.json"))).toBe(true);
  expect(existsSync(join(snapDir, "backend", "node_modules"))).toBe(false);
  expect(existsSync(join(snapDir, "frontend", ".next"))).toBe(false);
  expect(existsSync(join(snapDir, "history-agent.json"))).toBe(false);
});

test("an identical project is not copied twice", () => {
  const d = project();
  const a = takeSnapshot(d, "one")!;
  const b = takeSnapshot(d, "two")!;
  expect(b.id).toBe(a.id);
  expect(readdirSync(join(d, ".nexsidi", "snapshots")).length).toBe(1);
});

test("restoring puts changed files back, brings deleted files back and removes files added since", () => {
  const d = project();
  const s = takeSnapshot(d, "good")!;
  writeFileSync(join(d, "backend", "src", "app.ts"), "CORRUPTED");
  rmSync(join(d, "frontend", "app", "page.tsx"));
  writeFileSync(join(d, "backend", "src", "extra.ts"), "added by a bad run");
  const r = restoreSnapshot(d, s.id)!;
  expect(readFileSync(join(d, "backend", "src", "app.ts"), "utf-8")).toBe("export const a = 1;\n");
  expect(existsSync(join(d, "frontend", "app", "page.tsx"))).toBe(true);
  expect(existsSync(join(d, "backend", "src", "extra.ts"))).toBe(false);
  expect(r.restored.sort()).toEqual(["backend/src/app.ts", "frontend/app/page.tsx"]);
  expect(r.removed).toEqual(["backend/src/extra.ts"]);
});

test("restoring never touches dependencies, build output or agent histories", () => {
  const d = project();
  const s = takeSnapshot(d, "good")!;
  writeFileSync(join(d, "backend", "node_modules", "dep", "index.js"), "changed after");
  writeFileSync(join(d, "history-agent.json"), '["new"]');
  restoreSnapshot(d, s.id);
  expect(readFileSync(join(d, "backend", "node_modules", "dep", "index.js"), "utf-8")).toBe("changed after");
  expect(readFileSync(join(d, "history-agent.json"), "utf-8")).toBe('["new"]');
  expect(existsSync(join(d, "frontend", ".next", "cache.bin"))).toBe(true);
});

test("with no id, restore uses the most recent snapshot, and with none it does nothing", () => {
  const d = project();
  expect(restoreSnapshot(d)).toBeNull();
  takeSnapshot(d, "first");
  writeFileSync(join(d, "spec.json"), '{"name":"B"}');
  takeSnapshot(d, "second");
  writeFileSync(join(d, "spec.json"), "BROKEN");
  restoreSnapshot(d);
  expect(readFileSync(join(d, "spec.json"), "utf-8")).toBe('{"name":"B"}');
  expect(latestSnapshot(d)!.label).toBe("second");
});

test("only the most recent snapshots are kept", () => {
  const d = project();
  for (let i = 0; i < 5; i++) {
    writeFileSync(join(d, "spec.json"), JSON.stringify({ i }));
    takeSnapshot(d, `s${i}`, { keep: 3 });
  }
  expect(readdirSync(join(d, ".nexsidi", "snapshots")).length).toBe(3);
  expect(latestSnapshot(d)!.label).toBe("s4");
});

// ── the handoff file: written whole, checked, then moved into place in one step ──
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("a staged handoff file is invisible until committed, then holds exactly the context whose hash was recorded", () => {
  const d = project();
  const handoffDir = join(d, ".nexsidi", "handoffs");
  const context = { plan: ["a", "b"], n: 1 };
  const staged = stageHandoffFile(handoffDir, "0001-arjun-shubham.json", canonicalize(context));
  expect(existsSync(join(handoffDir, "0001-arjun-shubham.json"))).toBe(false);
  expect(staged.hash).toBe(hashContext(context));
  staged.commit();
  const final = readFileSync(join(handoffDir, "0001-arjun-shubham.json"), "utf-8");
  expect(sha(final)).toBe(hashContext(context));
  expect(readdirSync(handoffDir).filter((f) => f.startsWith(".tmp-"))).toEqual([]);
});

test("aborting a staged handoff leaves nothing behind, before or after it was committed", () => {
  const d = project();
  const handoffDir = join(d, ".nexsidi", "handoffs");
  const a = stageHandoffFile(handoffDir, "a.json", "{}");
  a.abort();
  expect(readdirSync(handoffDir)).toEqual([]);
  const b = stageHandoffFile(handoffDir, "b.json", "{}");
  b.commit();
  b.abort();
  expect(readdirSync(handoffDir)).toEqual([]);
});

test("a handoff that cannot be moved into place fails as a whole and leaves no half-written file", () => {
  const d = project();
  const handoffDir = join(d, ".nexsidi", "handoffs");
  mkdirSync(join(handoffDir, "blocked.json"), { recursive: true }); // a folder where the file must go
  const staged = stageHandoffFile(handoffDir, "blocked.json", "{}");
  expect(() => staged.commit()).toThrow();
  staged.abort();
  expect(readdirSync(handoffDir).filter((f) => f.startsWith(".tmp-"))).toEqual([]);
});
