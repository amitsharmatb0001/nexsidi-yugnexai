// Containers a builder started for its own check (2026-11-02, Brewline 7). The backend builder's test containers were still running
// when the frontend builder ran its check, set for another address. The frontend builder reported the refusal as a backend fault, the
// Chief AI routed it, and the backend builder changed tested settings to answer it. They end with the step that started them. Found
// by the folder they were started from, not by their name: Compose names them after the folder ("backend"), which every build shares,
// and the builder may already have deleted its compose file. The real deployment runs from the build's top folder, so it is never touched.
import { execFile } from "node:child_process";
import { resolve } from "node:path";

export type DockerRun = (args: string[]) => Promise<string>;

// Async on purpose: synchronous child processes fail with ETIMEDOUT inside the long-running worker.
const docker: DockerRun = (args) =>
  new Promise((done, fail) => {
    execFile("docker", args, { encoding: "utf-8", timeout: 60_000 }, (err, stdout) => (err ? fail(err) : done(stdout)));
  });

/** Removes the containers started from this folder, with their private data. Returns what it removed. */
export async function stopBuilderContainers(dir: string, run: DockerRun = docker): Promise<string[]> {
  try {
    const ids = (await run(["ps", "-aq", "--filter", `label=com.docker.compose.project.working_dir=${resolve(dir)}`])).split(/\s+/).filter(Boolean);
    if (ids.length === 0) return [];
    await run(["rm", "-f", "-v", ...ids]);
    console.log(`[containers] removed ${ids.length} private container(s) started from ${dir}`);
    return ids;
  } catch (err) {
    // Docker not answering must not stop a build; the next step tries again.
    console.warn(`[containers] not checked for ${dir}: ${String(err).slice(0, 160)}`);
    return [];
  }
}
