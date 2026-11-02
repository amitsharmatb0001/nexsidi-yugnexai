import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stopBuilderContainers } from "./private-containers.ts";

// 2026-11-02 (Brewline 7): the backend builder's own test containers were still running when the frontend builder ran its check,
// set for another address. The frontend builder reported the refusal as a backend fault, the Chief AI routed it, and the backend
// builder changed tested settings to answer it. Containers a builder started for itself end when its step ends.
test("a builder's own containers are removed, found by the folder they were started from", () => {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    return args[0] === "ps" ? "aaa\nbbb\n" : "";
  };
  expect(stopBuilderContainers("E:/b/brewline/backend", run)).toEqual(["aaa", "bbb"]);
  expect(calls[0]).toEqual(["ps", "-aq", "--filter", "label=com.docker.compose.project.working_dir=" + resolve("E:/b/brewline/backend")]);
  expect(calls[1]).toEqual(["rm", "-f", "-v", "aaa", "bbb"]);
});

test("nothing is removed when the builder started nothing", () => {
  const calls: string[][] = [];
  expect(stopBuilderContainers("E:/b/x/frontend", (a) => (calls.push(a), ""))).toEqual([]);
  expect(calls.length).toBe(1);
});

test("docker being unavailable does not stop the build", () => {
  expect(stopBuilderContainers("E:/b/x/frontend", () => { throw new Error("docker is not running"); })).toEqual([]);
});

test("every builder step and fix ends by removing its own containers", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf-8");
  expect(src).toMatch(/refreshAppMap\(buildDirFor\(projectId\)\);\s*stopBuilderContainers\(outputDirOf\(projectId, builder\)\);/);
  for (const b of ["shubham", "aanya"]) {
    const gen = readFileSync(new URL(`../../agents/generators/${b}/src/index.ts`, import.meta.url), "utf-8");
    expect({ b, ok: /finally \{\s*if \(team\?\.role !== "helper"\) stopBuilderContainers\(getOutputDir\(plan\.projectId\)\);/.test(gen) }).toEqual({ b, ok: true });
  }
});
