import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stopBuilderContainers } from "./private-containers.ts";

// 2026-11-02 (Brewline 7): the backend builder's own test containers were still running when the frontend builder ran its check,
// set for another address. The frontend builder reported the refusal as a backend fault, the Chief AI routed it, and the backend
// builder changed tested settings to answer it. Containers a builder started for itself end when its step ends.
test("a builder's own containers are removed, found by the folder they were started from", async () => {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    return args[0] === "ps" ? "aaa\nbbb\n" : "";
  };
  expect(await stopBuilderContainers("E:/b/brewline/backend", run)).toEqual(["aaa", "bbb"]);
  expect(calls[0]).toEqual(["ps", "-aq", "--filter", "label=com.docker.compose.project.working_dir=" + resolve("E:/b/brewline/backend")]);
  expect(calls[1]).toEqual(["rm", "-f", "-v", "aaa", "bbb"]);
});

test("nothing is removed when the builder started nothing", async () => {
  const calls: string[][] = [];
  expect(await stopBuilderContainers("E:/b/x/frontend", async (a) => (calls.push(a), ""))).toEqual([]);
  expect(calls.length).toBe(1);
});

test("docker being unavailable does not stop the build", async () => {
  expect(await stopBuilderContainers("E:/b/x/frontend", async () => { throw new Error("docker is not running"); })).toEqual([]);
});

// 2026-11-02 (Brewline 8): synchronous child processes fail with ETIMEDOUT inside the long-running worker (system-version.ts says so too).
// This cleanup used one and failed 14 of its 15 runs there, saying only "not checked".
test("the cleanup uses no synchronous child process, and the change step reports that it is alive", () => {
  const own = readFileSync(new URL("./private-containers.ts", import.meta.url), "utf-8");
  expect(own).not.toContain("spawnSync");
  const act = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(act.slice(act.indexOf("export async function applyChangeRequestActivity")).slice(0, 400)).toContain("ctx.heartbeat");
  const riya = readFileSync(new URL("../../agents/riya/src/index.ts", import.meta.url), "utf-8");
  const login = riya.slice(riya.indexOf("export async function provisionOwnerLoginFor"), riya.indexOf("function makeRealDbRowLookup"));
  expect(login).not.toContain("execSync");
});

test("every builder step and fix ends by removing its own containers", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).toMatch(/refreshAppMap\(buildDirFor\(projectId\)\);\s*await stopBuilderContainers\(outputDirOf\(projectId, builder\)\);/);
  for (const b of ["shubham", "aanya"]) {
    const gen = readFileSync(new URL(`../../agents/generators/${b}/src/index.ts`, import.meta.url), "utf-8");
    expect({ b, ok: /finally \{\s*if \(team\?\.role !== "helper"\) await stopBuilderContainers\(getOutputDir\(plan\.projectId\)\);/.test(gen) }).toEqual({ b, ok: true });
  }
});
