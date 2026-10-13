// Names Docker already holds data under. A build folder's name is also its compose project name, so volumes and
// containers of an earlier app that carried the same name would otherwise be picked up by a new one
// (Shopbill run 4: a new app started on run 2's database and never ran its migration).
import { execFile } from "node:child_process";
import { registerBuildFolder, buildRoot } from "./build-dir.ts";

/** Compose volume names are "<project>_<volume>"; the label lines are the project names themselves. */
export function projectNamesFromDocker(volumeNames: string[], projectLabels: string[]): string[] {
  const out = new Set<string>();
  for (const v of volumeNames) {
    const t = v.trim();
    const i = t.indexOf("_");
    if (i > 0) out.add(t.slice(0, i).toLowerCase());
  }
  for (const l of projectLabels) {
    const t = l.trim();
    if (t) out.add(t.toLowerCase());
  }
  return [...out];
}

const run = (args: string[]): Promise<string[]> =>
  new Promise((resolve) => {
    execFile("docker", args, { timeout: 15_000, windowsHide: true }, (err, stdout) => {
      resolve(err ? [] : String(stdout).split(/\r?\n/));
    });
  });

/** Every compose project name Docker holds a volume or container for. Empty when Docker cannot be asked. */
export async function dockerProjectNames(): Promise<string[]> {
  const [volumes, labels] = await Promise.all([
    run(["volume", "ls", "--format", "{{.Name}}"]),
    run(["ps", "-a", "--format", '{{.Label "com.docker.compose.project"}}']),
  ]);
  return projectNamesFromDocker(volumes, labels);
}

/** registerBuildFolder, never picking a name existing Docker data already carries. */
export async function registerBuildFolderSafely(projectId: string, name: string, root: string = buildRoot()): Promise<string> {
  return registerBuildFolder(projectId, name, root, await dockerProjectNames());
}
