import { test, expect } from "bun:test";
import { toPosixPath, parseNameStatus, getDiffFiles, revertFile, type DiffFile } from "./artifacts.ts";

// 2026-08-19: real bug found live — the artifact tree emitted paths straight
// off Node's join(), so on Windows every path used backslashes
// ("backend\src\controllers\admin.ts"). The web client splits on "/" to build
// its folder tree, so nothing nested: the explorer showed one flat row per
// file with the raw backslash path as its label. The same string is echoed
// back as ?path= on the file endpoint, so this wire format has to be
// platform-independent either way.

test("toPosixPath converts Windows separators to forward slashes", () => {
  expect(toPosixPath("backend\\src\\controllers\\admin.ts")).toBe("backend/src/controllers/admin.ts");
});

test("toPosixPath leaves an already-POSIX path unchanged", () => {
  expect(toPosixPath("backend/src/app.ts")).toBe("backend/src/app.ts");
});

test("toPosixPath normalises mixed separators, which Windows joins can produce", () => {
  expect(toPosixPath("frontend\\app/dashboard\\page.tsx")).toBe("frontend/app/dashboard/page.tsx");
});

test("toPosixPath collapses repeated separators rather than emitting empty segments", () => {
  // An empty segment would render as a nameless folder in the client's tree.
  expect(toPosixPath("db\\\\migrations\\0000_initial.sql")).toBe("db/migrations/0000_initial.sql");
});

test("toPosixPath handles a bare filename at the project root", () => {
  expect(toPosixPath("docker-compose.yml")).toBe("docker-compose.yml");
});

test("toPosixPath produces segments a client can split on '/' to nest correctly", () => {
  // The actual property the explorer depends on.
  expect(toPosixPath("backend\\src\\routes\\index.ts").split("/")).toEqual([
    "backend",
    "src",
    "routes",
    "index.ts",
  ]);
});

// The Changes view answers "what did this build produce". The pipeline's own
// logs and QA bookkeeping dominate that diff by line count (a single run's
// pipeline.log was +914 lines against ~60 lines of real source edits), so
// they are excluded from the file list.
import { isPipelineBookkeeping } from "./artifacts.ts";

test("isPipelineBookkeeping excludes the run's own log directory", () => {
  expect(isPipelineBookkeeping("logs/pipeline.log")).toBe(true);
  expect(isPipelineBookkeeping("logs/events.jsonl")).toBe(true);
});

test("isPipelineBookkeeping excludes per-agent history and QA submission files", () => {
  expect(isPipelineBookkeeping("history-riya.json")).toBe(true);
  expect(isPipelineBookkeeping("qa-submissions.json")).toBe(true);
});

test("isPipelineBookkeeping keeps real generated source and config", () => {
  expect(isPipelineBookkeeping("docker-compose.yml")).toBe(false);
  expect(isPipelineBookkeeping("frontend/Dockerfile")).toBe(false);
  expect(isPipelineBookkeeping("backend/src/app.ts")).toBe(false);
  expect(isPipelineBookkeeping("db/migrations/0000_initial.sql")).toBe(false);
});

test("isPipelineBookkeeping does not exclude an app file that merely mentions history", () => {
  // The pattern is anchored, so a real source file is never mistaken for one
  // of the pipeline's own records.
  expect(isPipelineBookkeeping("frontend/lib/history-store.ts")).toBe(false);
  expect(isPipelineBookkeeping("backend/src/logs.ts")).toBe(false);
});

// ── parseNameStatus ──────────────────────────────────────────────────────────
// Accept/reject need to know not just THAT a file changed but HOW (added vs
// modified vs deleted), since a brand-new file has no baseline blob to
// revert to — it has to be removed instead. This is the classification that
// decision rests on.

test("parseNameStatus classifies A/M/D codes correctly", () => {
  const raw = "A\tsrc/new.ts\nM\tsrc/existing.ts\nD\tsrc/removed.ts";
  const result = parseNameStatus(raw);
  expect(result.get("src/new.ts")).toBe("added");
  expect(result.get("src/existing.ts")).toBe("modified");
  expect(result.get("src/removed.ts")).toBe("deleted");
});

test("parseNameStatus folds a rename (two tab-separated paths) into 'modified' keyed by the destination path", () => {
  const result = parseNameStatus("R100\tsrc/old-name.ts\tsrc/new-name.ts");
  expect(result.get("src/new-name.ts")).toBe("modified");
  expect(result.has("src/old-name.ts")).toBe(false);
});

test("parseNameStatus ignores blank lines", () => {
  const result = parseNameStatus("A\tsrc/a.ts\n\n\nM\tsrc/b.ts\n");
  expect(result.size).toBe(2);
});

test("parseNameStatus converts backslash paths from a Windows git process to forward slashes", () => {
  const result = parseNameStatus("M\tbackend\\src\\app.ts");
  expect(result.has("backend/src/app.ts")).toBe(true);
});

// ── getDiffFiles ─────────────────────────────────────────────────────────────
// Injects a fake git runner (same DI pattern resolveBaseline already uses)
// so this exercises the real numstat/name-status merge logic without a real
// repository on disk.

// `blobs` maps a path to the fake blob hash `git rev-parse HEAD:<path>`
// should return for it — used by getDiffFiles' contentHash lookup for
// every non-deleted file.
function fakeGit(responses: Record<string, string>, blobs: Record<string, string> = {}) {
  return (args: string[]) => {
    if (args[0] === "rev-parse" && args[1]?.startsWith("HEAD:")) {
      const path = args[1].slice("HEAD:".length);
      const hash = blobs[path];
      if (hash === undefined) throw new Error(`no such path at HEAD: ${path}`);
      return hash;
    }
    const key = args[0] === "diff" && args.includes("--numstat") ? "numstat"
      : args[0] === "diff" && args.includes("--name-status") ? "name-status"
      : args.join(" ");
    return (responses[key] ?? "").trim();
  };
}

test("getDiffFiles merges numstat line counts with name-status classification by path", () => {
  const git = fakeGit({
    numstat: "12\t0\tsrc/new.ts\n3\t5\tsrc/existing.ts",
    "name-status": "A\tsrc/new.ts\nM\tsrc/existing.ts",
  }, { "src/new.ts": "hash-new", "src/existing.ts": "hash-existing" });

  const files = getDiffFiles(git, "abc1234");

  expect(files).toEqual([
    { path: "src/new.ts", added: 12, removed: 0, binary: false, status: "added", contentHash: "hash-new" },
    { path: "src/existing.ts", added: 3, removed: 5, binary: false, status: "modified", contentHash: "hash-existing" },
  ]);
});

test("getDiffFiles marks a binary file (numstat '-' columns) rather than coercing to 0", () => {
  const git = fakeGit({
    numstat: "-\t-\tpublic/logo.png",
    "name-status": "A\tpublic/logo.png",
  }, { "public/logo.png": "hash-logo" });

  const files = getDiffFiles(git, "abc1234");
  expect(files[0]).toMatchObject({ added: null, removed: null, binary: true, status: "added" });
});

test("getDiffFiles excludes pipeline bookkeeping files even when git reports them changed", () => {
  const git = fakeGit({
    numstat: "5\t0\tlogs/pipeline.log\n2\t1\tsrc/app.ts",
    "name-status": "M\tlogs/pipeline.log\nM\tsrc/app.ts",
  }, { "logs/pipeline.log": "h1", "src/app.ts": "h2" });

  const files = getDiffFiles(git, "abc1234");
  expect(files.map((f) => f.path)).toEqual(["src/app.ts"]);
});

test("getDiffFiles defaults to 'modified' for a path numstat reports that name-status didn't classify", () => {
  // Defensive fallback — the two git calls should always agree, but a
  // mismatch must never crash the endpoint or silently drop the file.
  const git = fakeGit({ numstat: "1\t1\tsrc/mystery.ts", "name-status": "" }, { "src/mystery.ts": "h" });
  const files = getDiffFiles(git, "abc1234");
  expect(files[0]?.status).toBe("modified");
});

test("getDiffFiles uses the literal 'deleted' content hash for a removed file, never looking it up at HEAD", () => {
  const git = fakeGit({
    numstat: "0\t3\tsrc/gone.ts",
    "name-status": "D\tsrc/gone.ts",
  }); // no blob entry for src/gone.ts — a rev-parse attempt would throw

  const files = getDiffFiles(git, "abc1234");
  expect(files[0]).toMatchObject({ status: "deleted", contentHash: "deleted" });
});

// ── revertFile ───────────────────────────────────────────────────────────────
// The decision this makes is the one accept/reject's whole safety story rests
// on: a file that never existed at the baseline has no baseline blob for
// `git checkout` to restore, so rejecting it must remove it instead.

function fileOf(status: DiffFile["status"], path = "src/f.ts"): DiffFile {
  return { path, added: 1, removed: 1, binary: false, status, contentHash: status === "deleted" ? "deleted" : "h" };
}

test("revertFile removes an added file rather than trying to check it out", () => {
  const calls: string[][] = [];
  const git = (args: string[]) => { calls.push(args); return ""; };

  revertFile(git, "abc1234", fileOf("added"));

  expect(calls).toEqual([["rm", "-f", "--", "src/f.ts"]]);
});

test("revertFile checks out the baseline blob for a modified file", () => {
  const calls: string[][] = [];
  const git = (args: string[]) => { calls.push(args); return ""; };

  revertFile(git, "abc1234", fileOf("modified"));

  expect(calls).toEqual([["checkout", "abc1234", "--", "src/f.ts"]]);
});

test("revertFile checks out the baseline blob to restore a deleted file", () => {
  const calls: string[][] = [];
  const git = (args: string[]) => { calls.push(args); return ""; };

  revertFile(git, "abc1234", fileOf("deleted"));

  expect(calls).toEqual([["checkout", "abc1234", "--", "src/f.ts"]]);
});
