import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderNameFor, buildDirFor, registerBuildFolder, buildRoot } from "./build-dir.ts";

// 2026-10-08 (Amit): the build folder (and, because docker compose names its project after the folder, every
// container, network and volume) carried a random id like 52c4d13c5e0d. It now carries the app's own name:
// ledgerly-2, ledgerly-2-frontend-1. The id stays the key in the database and the workflow; only the folder name
// changes, through ONE function (buildDirFor). With no entry for a project it returns the old id path, so every
// existing project keeps working untouched.

const prev = process.env.BUILD_DIR;
let root = "";
afterEach(() => {
  if (prev === undefined) delete process.env.BUILD_DIR; else process.env.BUILD_DIR = prev;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});
const fresh = () => { root = mkdtempSync(join(tmpdir(), "build-dir-")); process.env.BUILD_DIR = root; return root; };

test("folderNameFor turns a name into a safe folder (and docker project) name", () => {
  expect(folderNameFor("Ledgerly")).toBe("ledgerly");
  expect(folderNameFor("Ledgerly 2")).toBe("ledgerly-2");
  expect(folderNameFor("  My App!! (Beta) ")).toBe("my-app-beta");
  expect(folderNameFor("Café Stock")).toBe("cafe-stock");
  expect(folderNameFor("NexTech Technologies Pvt. Ltd.")).toBe("nextech-technologies-pvt-ltd");
  expect(folderNameFor("a".repeat(80))!.length).toBeLessThanOrEqual(40);
  expect(folderNameFor("x".repeat(39) + " tail")).not.toMatch(/-$/);
  expect(folderNameFor("")).toBeNull();
  expect(folderNameFor("!!! ???")).toBeNull();
  expect(folderNameFor("नमस्ते")).toBeNull();
  for (const n of ["Ledgerly 2", "  My App!! ", "Café", "99 Problems", "_x_"]) {
    const f = folderNameFor(n);
    if (f) expect(f).toMatch(/^[a-z0-9][a-z0-9_-]*$/); // what `docker compose` accepts as a project name
  }
});

test("buildDirFor returns the old id path when the project has no name entry", () => {
  const r = fresh();
  expect(buildDirFor("52c4d13c5e0d")).toBe(join(r, "52c4d13c5e0d"));
  expect(buildDirFor("52c4d13c5e0d", "/other/root")).toBe(join("/other/root", "52c4d13c5e0d"));
  expect(buildRoot()).toBe(r);
});

test("registerBuildFolder creates the named folder and buildDirFor then returns it", () => {
  const r = fresh();
  const folder = registerBuildFolder("52c4d13c5e0d", "Ledgerly 2");
  expect(folder).toBe("ledgerly-2");
  expect(existsSync(join(r, "ledgerly-2"))).toBe(true);
  expect(buildDirFor("52c4d13c5e0d")).toBe(join(r, "ledgerly-2"));
  expect(buildDirFor("someone-else")).toBe(join(r, "someone-else"));
});

test("registering the same project again keeps its folder, even if the name is different", () => {
  fresh();
  expect(registerBuildFolder("aaaaaaaaaaaa", "Ledgerly")).toBe("ledgerly");
  expect(registerBuildFolder("aaaaaaaaaaaa", "Totally Renamed")).toBe("ledgerly");
});

test("two projects with the same name get different folders; an existing folder is never reused", () => {
  const r = fresh();
  expect(registerBuildFolder("aaaaaaaaaaaa", "Ledgerly")).toBe("ledgerly");
  expect(registerBuildFolder("bbbbbbbbbbbb", "Ledgerly")).toBe("ledgerly-2");
  expect(registerBuildFolder("cccccccccccc", "Ledgerly")).toBe("ledgerly-3");
  mkdirSync(join(r, "stockroom")); // an old folder that is not in the registry
  expect(registerBuildFolder("dddddddddddd", "Stockroom")).toBe("stockroom-2");
});

test("a name that cannot make a folder falls back to the project id", () => {
  const r = fresh();
  expect(registerBuildFolder("eeeeeeeeeeee", "!!!")).toBe("eeeeeeeeeeee");
  expect(buildDirFor("eeeeeeeeeeee")).toBe(join(r, "eeeeeeeeeeee"));
});

test("an id that could escape the build folder is refused", () => {
  fresh();
  expect(() => registerBuildFolder("../evil", "Ledgerly")).toThrow();
  expect(() => registerBuildFolder("a/b", "Ledgerly")).toThrow();
});

test("a damaged registry file never throws — the old id path is used", () => {
  const r = fresh();
  writeFileSync(join(r, ".folders.json"), "{ not json", "utf-8");
  expect(buildDirFor("52c4d13c5e0d")).toBe(join(r, "52c4d13c5e0d"));
  expect(registerBuildFolder("52c4d13c5e0d", "Ledgerly")).toBe("ledgerly"); // and it repairs itself
  expect(JSON.parse(readFileSync(join(r, ".folders.json"), "utf-8"))["52c4d13c5e0d"]).toBe("ledgerly");
});

test("a change made by another process is seen at once (the API registers, the worker reads)", () => {
  const r = fresh();
  expect(buildDirFor("ffffffffffff")).toBe(join(r, "ffffffffffff"));
  writeFileSync(join(r, ".folders.json"), JSON.stringify({ ffffffffffff: "tallyo" }), "utf-8");
  expect(buildDirFor("ffffffffffff")).toBe(join(r, "tallyo"));
});
