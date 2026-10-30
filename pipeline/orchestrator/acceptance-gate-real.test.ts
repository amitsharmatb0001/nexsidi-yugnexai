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
