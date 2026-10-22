import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { execDbQuery, isReadOnlyQuery } from "./tools/db.ts";

// 2026-10-22 (Trailhead rerun, deploy retry): the final reviewer called db_query with no query; isReadOnlyQuery ran
// undefined.trim(), the error escaped the agent loop, and the whole deploy step failed after 98 minutes of work (three
// passing redeploys). A tool's own bug or a malformed call must come back to the agent as an error result it can read and
// recover from, never end the step. Both agent loops now catch any tool error at the dispatch.

test("db_query with a missing or non-text query is a clean error, not a crash", async () => {
  process.env.TIER3_DB_URL = "postgres://u:p@127.0.0.1:1/x";
  for (const bad of [undefined, null, 42, {}]) {
    const r = await execDbQuery({ query: bad as never });
    expect(r.status).toBe("error");
    expect(String(r.summary)).toContain("query");
  }
  delete process.env.TIER3_DB_URL;
  expect(isReadOnlyQuery(undefined as never).ok).toBe(false);
});

for (const file of ["gemini-loop.ts", "loop.ts"]) {
  test(`${file} turns any tool error into an error result instead of ending the step`, () => {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf-8");
    expect(src).toContain("} else try { switch (toolName) {");
    expect(src).toContain("failed inside the tool, the step goes on");
  });
}
