// Prints the app map of a build folder: bun pipeline/orchestrator/app-map/cli.ts <build folder> [--json]
import { buildAppMap, renderAppMap } from "./index.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: bun pipeline/orchestrator/app-map/cli.ts <build folder> [--json]");
  process.exit(1);
}
const map = buildAppMap(dir);
console.log(process.argv.includes("--json") ? JSON.stringify(map, null, 2) : renderAppMap(map));
