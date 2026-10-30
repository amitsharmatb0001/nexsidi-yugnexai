// Prints the app map of a build folder: bun pipeline/orchestrator/app-map/cli.ts <build folder> [--json] [--rules]
// --rules prints the broken rules (rules.ts) instead of the map.
import { buildAppMap, renderAppMap } from "./index.ts";
import { checkRules, ruleFindings } from "./rules.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: bun pipeline/orchestrator/app-map/cli.ts <build folder> [--json] [--rules]");
  process.exit(1);
}
const map = buildAppMap(dir);
if (process.argv.includes("--rules")) {
  const v = checkRules(dir, map);
  console.log(process.argv.includes("--json") ? JSON.stringify(v, null, 2) : ruleFindings(v).map((l, i) => `${v[i]!.owner}: ${l}`).join("\n") || "no rule broken");
} else {
  console.log(process.argv.includes("--json") ? JSON.stringify(map, null, 2) : renderAppMap(map));
}
