import { test, expect } from "bun:test";
import { oneAtATime } from "./acceptance-gate-real.ts";

// 2026-10-30 (team plan, stage 4): fix runs finish in parallel, and each one's finish check rebuilds the app. Two
// `docker compose up --build` at once on the same project would fight; the rebuilds run one after another, and a failed
// one does not stop the next.
test("jobs run one at a time, in order, and a failure does not block the next", async () => {
  const serial = oneAtATime();
  const log: string[] = [];
  const job = (name: string, ms: number, fail = false) => () =>
    new Promise<string>((resolve, reject) => {
      log.push(`start ${name}`);
      setTimeout(() => {
        log.push(`end ${name}`);
        fail ? reject(new Error(name)) : resolve(name);
      }, ms);
    });
  const results = await Promise.allSettled([serial(job("a", 30)), serial(job("b", 5, true)), serial(job("c", 1))]);
  expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
});

// 2026-10-30 (understanding plan, step 5): the real gate judges progress by the code's facts too.
test("the real gate reads the code's facts: the broken rules by identity and the digest", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { realGateDeps } = await import("./acceptance-gate-real.ts");
  const root = mkdtempSync(join(tmpdir(), "gate-real-"));
  const prev = process.env.BUILD_DIR;
  process.env.BUILD_DIR = root;
  mkdirSync(join(root, "pf", "backend", "src"), { recursive: true });
  writeFileSync(join(root, "pf", "backend", "src", "q.ts"), "export const q = async (req, res) => { await pool.query(`SELECT 1 WHERE x = '${req.body.x}'`); };");
  const { deps } = realGateDeps("pf", { projectId: "pf" } as never);
  const f = deps.facts!();
  if (prev === undefined) delete process.env.BUILD_DIR;
  else process.env.BUILD_DIR = prev;
  rmSync(root, { recursive: true, force: true });
  expect(f.open).toEqual(["SEC1|function:backend/src/q.ts#q"]);
  expect(f.digest).toMatch(/^[0-9a-f]{64}$/);
});
