import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

// 2026-10-22 (Trailhead rerun): the deploy step (deploy, live review, fix, redeploy, up to three rounds of ~35-40 minutes)
// was killed by its fixed 2-hour clock during its third round, after every check of that redeploy had passed; the build
// ended as "deploy_activity_error" and claim 2 could not be shown. The pre-deploy review loop had the same 2-hour clock. Both
// report progress every 30 seconds, and the cost and progress guards already stop spending that goes nowhere, so the clock
// is a ceiling for a runaway, not the limit a normal build meets. A dead worker is still caught by the 3-minute heartbeat.
const wf = readFileSync(new URL("./project-build.ts", import.meta.url), "utf-8");
const proxy = (name: string) => {
  const at = wf.indexOf(`const ${name} = proxyActivities`);
  return wf.slice(at, wf.indexOf("});", at));
};

for (const name of ["orchestratorAct", "deployRetestAct"]) {
  test(`${name} has a 6-hour ceiling and a 3-minute heartbeat`, () => {
    expect(proxy(name)).toContain('startToCloseTimeout: "6 hours"');
    expect(proxy(name)).toContain('heartbeatTimeout: "3 minutes"');
  });
}
