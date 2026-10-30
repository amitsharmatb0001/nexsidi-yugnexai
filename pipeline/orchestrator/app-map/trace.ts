// The links from a plan item to the code that carries it, from facts (2026-10-30, understanding plan step 4; patent claim 3's
// bidirectional traceability). packages/context-chain/src/traceability.ts links requirements to tasks by shared words; here
// every link names the fact it rests on:
//   plan item → endpoint / page / table   the item names it exactly, or one of its acceptance tests requests or opens it
//   endpoint  → files                     the route, the handler, the files of its queries
//   page      → files                     the page file and the files its API calls are in
//   table     → files                     the migrations that create it or add its columns
// handoffFacts is what goes into the hashed handoff context: code facts only (no times, no tests, which change between the
// record and the check without the code changing).
import { hashContext } from "../../../packages/context-chain/src/hash.ts";
import { readAcceptanceTests, type ApiStep, type JourneyStep } from "../acceptance-tests.ts";
import { pathFits } from "../acceptance-tests.ts";
import { buildAppMap, type AppMap } from "./index.ts";
import { checkRules, ruleFindings } from "./rules.ts";
import { findingIdentity } from "./identity.ts";

export interface TraceLink {
  from: string;
  to: string;
  reason: string;
}

function linksFromPlanText(map: AppMap): TraceLink[] {
  return map.plan.flatMap((p) => [
    ...p.endpoints.map((e) => ({ from: p.item, to: `endpoint:${e}`, reason: "the plan item names this endpoint" })),
    ...p.pages.map((r) => ({ from: p.item, to: `page:${r}`, reason: "the plan item names this page" })),
    ...p.tables.map((t) => ({ from: p.item, to: `table:${t}`, reason: "the plan item names this table" })),
  ]);
}

function linksToFiles(map: AppMap): TraceLink[] {
  const out: TraceLink[] = [];
  for (const e of map.endpoints) {
    const key = `endpoint:${e.method} ${e.path}`;
    const files = new Map<string, string>([[e.file, "the route is defined here"]]);
    if (!files.has(e.handlerFile)) files.set(e.handlerFile, `the handler ${e.handler} is here`);
    for (const q of e.sql) if (!files.has(q.file)) files.set(q.file, `its query in ${q.function} is here`);
    for (const [f, reason] of files) out.push({ from: key, to: f, reason });
  }
  for (const p of map.pages) {
    const files = new Map<string, string>([[p.file, "the page file"]]);
    for (const c of p.calls) if (!files.has(c.file)) files.set(c.file, `its call ${c.method} ${c.path} is here`);
    for (const [f, reason] of files) out.push({ from: `page:${p.route}`, to: f, reason });
  }
  for (const [t, facts] of Object.entries(map.database.tables)) {
    const files = new Set<string>([facts.createdIn, ...Object.values(facts.columns).map((c) => c.addedIn)].filter(Boolean));
    for (const f of [...files].sort()) out.push({ from: `table:${t}`, to: f, reason: f === facts.createdIn ? "the migration that creates it" : "a migration that adds a column" });
  }
  return out;
}

/** Every link, the tests' included when the build folder is given. */
export function structuralTrace(map: AppMap, projectDir?: string): TraceLink[] {
  const out = [...linksFromPlanText(map)];
  const tests = projectDir ? readAcceptanceTests(projectDir)?.tests ?? [] : [];
  for (const t of tests) {
    if (t.kind === "api") {
      for (const s of t.steps as ApiStep[]) {
        const e = map.endpoints.find((x) => x.method === s.method && pathFits(x.path, s.path));
        if (e) out.push({ from: t.planItem, to: `endpoint:${e.method} ${e.path}`, reason: `its test ${t.id} requests it` });
      }
    } else {
      for (const s of t.steps as JourneyStep[]) {
        if (s.do !== "open") continue;
        const p = map.pages.find((x) => pathFits(x.route.replace(/\[[^\]]+\]/g, ":param"), s.path.split("?")[0]!));
        if (p) out.push({ from: t.planItem, to: `page:${p.route}`, reason: `its test ${t.id} opens it` });
      }
    }
  }
  out.push(...linksToFiles(map));
  // One link per pair: the first reason found.
  const seen = new Set<string>();
  return out.filter((l) => {
    const k = `${l.from}→${l.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface HandoffFacts {
  /** SHA-256 of the code facts (database, schema file, endpoints with their queries, functions, pages) */
  digest: string;
  endpoints: string[];
  tables: string[];
  trace: TraceLink[];
}

export function handoffFacts(map: AppMap): HandoffFacts {
  const code = { database: map.database, schemaFile: map.schemaFile, endpoints: map.endpoints, functions: map.functions, pages: map.pages };
  return {
    digest: hashContext(code),
    endpoints: map.endpoints.map((e) => `${e.method} ${e.path} → ${e.handlerFile}`).sort(),
    tables: Object.keys(map.database.tables).sort(),
    trace: structuralTrace(map),
  };
}

/**
 * The code's facts for the progress guard (understanding plan step 5): the identities of the rules the map finds broken
 * (identity.ts — the same fact in a new place is new, the same fact found again is not), and the digest of what the map reads.
 */
export function codeFacts(projectDir: string): { open: string[]; digest: string } {
  const map = buildAppMap(projectDir);
  const violations = checkRules(projectDir, map);
  const lines = ruleFindings(violations);
  const open = [...new Set(violations.map((v, i) => findingIdentity(map, { file: v.file, issue: lines[i]! })))].sort();
  return { open, digest: handoffFacts(map).digest };
}
