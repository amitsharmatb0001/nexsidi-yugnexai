import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSystemVersion,
  stampSystemVersion,
  checkSystemVersion,
  acceptPendingSystemVersion,
  systemVersionFacts,
  type SystemVersion,
  type GitRunner,
} from "./system-version.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sysver-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const v = (id: string, trees: Record<string, string> = { pipeline: `t-${id}` }, dirtyFiles: string[] = []): SystemVersion => ({
  id,
  commit: `c-${id}`,
  trees,
  dirtyFiles,
});
const record = () => JSON.parse(readFileSync(join(dir, ".nexsidi", "system-version.json"), "utf-8"));

// ── reading the version from git ────────────────────────────────────────────

function fakeGit(answers: Record<string, string>): GitRunner {
  return async (args) => {
    const key = args.join(" ");
    if (key in answers) return answers[key]!;
    if (args[0] === "status" && "status" in answers) return answers.status!;
    throw new Error(`unexpected git ${key}`);
  };
}

test("the version id depends on the source folders' content, not on the commit", async () => {
  const trees = { "rev-parse HEAD:agents": "a1\n", "rev-parse HEAD:packages": "p1\n", "rev-parse HEAD:pipeline": "q1\n", "rev-parse HEAD:apps/api": "x1\n", "status": "" };
  const one = await readSystemVersion(dir, fakeGit({ ...trees, "rev-parse HEAD": "commit-one\n" }));
  const two = await readSystemVersion(dir, fakeGit({ ...trees, "rev-parse HEAD": "commit-two\n" }));
  expect(one?.id).toBe(two!.id);
  expect(one?.commit).toBe("commit-one");
});

test("a changed source folder gives a different version id", async () => {
  const base = { "rev-parse HEAD:agents": "a1\n", "rev-parse HEAD:packages": "p1\n", "rev-parse HEAD:apps/api": "x1\n", "status": "", "rev-parse HEAD": "c\n" };
  const one = await readSystemVersion(dir, fakeGit({ ...base, "rev-parse HEAD:pipeline": "q1\n" }));
  const two = await readSystemVersion(dir, fakeGit({ ...base, "rev-parse HEAD:pipeline": "q2\n" }));
  expect(one!.id).not.toBe(two!.id);
});

test("an uncommitted edit to a source file changes the version id and is named", async () => {
  mkdirSync(join(dir, "pipeline"), { recursive: true });
  writeFileSync(join(dir, "pipeline", "x.ts"), "one", "utf-8");
  const answers = { "rev-parse HEAD:agents": "a\n", "rev-parse HEAD:packages": "p\n", "rev-parse HEAD:pipeline": "q\n", "rev-parse HEAD:apps/api": "x\n", "rev-parse HEAD": "c\n", "status": " M pipeline/x.ts\n" };
  const one = await readSystemVersion(dir, fakeGit(answers));
  writeFileSync(join(dir, "pipeline", "x.ts"), "two", "utf-8");
  const two = await readSystemVersion(dir, fakeGit(answers));
  expect(one!.dirtyFiles).toEqual(["pipeline/x.ts"]);
  expect(one!.id).not.toBe(two!.id);
});

test("a git failure gives no version (the caller records it as not checked)", async () => {
  const failing: GitRunner = async () => {
    throw new Error("git not found");
  };
  expect(await readSystemVersion(dir, failing)).toBeNull();
});

// ── the stamp at build start ───────────────────────────────────────────────

test("the first stamp records the starting version and accepts it", () => {
  stampSystemVersion(dir, v("A"), "spec");
  const r = record();
  expect(r.started.id).toBe("A");
  expect(r.accepted).toEqual(["A"]);
  expect(r.pending).toBeNull();
});

test("a second stamp does not replace the starting version", () => {
  stampSystemVersion(dir, v("A"), "spec");
  stampSystemVersion(dir, v("B"), "spec");
  expect(record().started.id).toBe("A");
});

// ── the check before paid work ─────────────────────────────────────────────

test("the same version passes", () => {
  stampSystemVersion(dir, v("A"), "spec");
  expect(checkSystemVersion(dir, v("A"), "generation").ok).toBe(true);
});

test("a changed version holds, names the changed folders, and is kept as pending", () => {
  stampSystemVersion(dir, v("A", { pipeline: "q1", agents: "a1" }), "spec");
  const verdict = checkSystemVersion(dir, v("B", { pipeline: "q2", agents: "a1" }, ["pipeline/x.ts"]), "qa");
  expect(verdict.ok).toBe(false);
  if (verdict.ok) return;
  expect(verdict.reason).toContain("changed while this build was running");
  expect(verdict.evidence.join(" ")).toContain("pipeline");
  expect(verdict.evidence.join(" ")).not.toContain("agents");
  expect(verdict.evidence.join(" ")).toContain("pipeline/x.ts");
  expect(record().pending.id).toBe("B");
});

test("the hold names only the files that changed since the build started", () => {
  const start = { ...v("A"), dirty: { "pipeline/a.ts": "h1", "pipeline/b.ts": "h2" } };
  stampSystemVersion(dir, start, "spec");
  const now = { ...v("B"), trees: start.trees, dirty: { "pipeline/a.ts": "h1", "pipeline/b.ts": "h3", "pipeline/new.ts": "h4" } };
  const verdict = checkSystemVersion(dir, now, "qa");
  if (verdict.ok) throw new Error("expected a hold");
  const text = verdict.evidence.join(" ");
  expect(text).toContain("pipeline/b.ts");
  expect(text).toContain("pipeline/new.ts");
  expect(text).not.toContain("pipeline/a.ts");
});

test("a build with no stamp is stamped at its first check and passes", () => {
  expect(checkSystemVersion(dir, v("A"), "qa").ok).toBe(true);
  const r = record();
  expect(r.started.id).toBe("A");
  expect(r.events[0].detail).toContain("stamped late");
});

test("a version that cannot be read passes but is recorded as not checked", () => {
  stampSystemVersion(dir, v("A"), "spec");
  expect(checkSystemVersion(dir, null, "deploy").ok).toBe(true);
  expect(record().events.some((e: { kind: string; step: string }) => e.kind === "not_checked" && e.step === "deploy")).toBe(true);
});

// ── the owner's Retry ──────────────────────────────────────────────────────

test("Retry accepts the pending version, and the next check passes", () => {
  stampSystemVersion(dir, v("A"), "spec");
  checkSystemVersion(dir, v("B"), "qa");
  expect(acceptPendingSystemVersion(dir)).toBe("B");
  expect(record().pending).toBeNull();
  expect(checkSystemVersion(dir, v("B"), "qa").ok).toBe(true);
});

test("Retry with nothing pending accepts nothing", () => {
  stampSystemVersion(dir, v("A"), "spec");
  expect(acceptPendingSystemVersion(dir)).toBeNull();
  expect(record().accepted).toEqual(["A"]);
});

test("Retry on a build without a version file does nothing", () => {
  expect(acceptPendingSystemVersion(dir)).toBeNull();
  expect(existsSync(join(dir, ".nexsidi", "system-version.json"))).toBe(false);
});

// ── facts for the success sheet ────────────────────────────────────────────

test("facts count the changes, the accepted changes and the checks that could not run", () => {
  stampSystemVersion(dir, v("A"), "spec");
  checkSystemVersion(dir, v("B"), "qa");
  acceptPendingSystemVersion(dir);
  checkSystemVersion(dir, null, "deploy");
  expect(systemVersionFacts(dir)).toEqual({ recorded: true, startedOn: "A", changes: 1, accepted: 1, notChecked: 1 });
});

test("facts say not recorded for a build that predates the stamp", () => {
  expect(systemVersionFacts(dir)).toEqual({ recorded: false, startedOn: null, changes: 0, accepted: 0, notChecked: 0 });
});
