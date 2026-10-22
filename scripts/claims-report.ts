// Which patent-claim steps ran in one build, with the evidence each left behind.
//
//   bun scripts/claims-report.ts <projectId>
//
// Reads <build>/.nexsidi/claims-evidence.jsonl (written by the pipeline as each step runs) and, for claim 10, checks the
// project's whole hash chain again from the database (every record's predecessors and chain hash recomputed). A claim
// with no evidence is printed as NOT SHOWN: it did not run in this build, or it ran before evidence was recorded.
import { buildDirFor } from "../packages/agent-runtime/src/build-dir.ts";
import { readClaimEvidence, summarizeClaims } from "../packages/agent-runtime/src/claims-evidence.ts";

const projectId = process.argv[2];
if (!projectId) {
  console.error("usage: bun scripts/claims-report.ts <projectId>");
  process.exit(1);
}

const dir = buildDirFor(projectId);
const rows = readClaimEvidence(dir);
console.log(`Project ${projectId}  (${dir})`);
console.log(`${rows.length} evidence line(s)\n`);

const brief = (d: Record<string, unknown>) => Object.entries(d).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" ").slice(0, 220);

for (const s of summarizeClaims(rows)) {
  console.log(`Claim ${String(s.claim).padStart(2)}  ${s.ran ? "SHOWN    " : "NOT SHOWN"}  ${s.title}`);
  // Each distinct step once, with how often it happened and its latest details.
  const steps = new Map<string, { n: number; last: Record<string, unknown> }>();
  for (const e of s.entries) steps.set(e.step, { n: (steps.get(e.step)?.n ?? 0) + 1, last: e.detail });
  for (const [step, { n, last }] of steps) console.log(`            ${n}x ${step}${Object.keys(last).length ? `  [latest: ${brief(last)}]` : ""}`);
}

// Claim 10, checked independently of the evidence file: recompute the chain from the database.
try {
  const { auditProjectChain } = await import("../pipeline/activities/context-chain-activities.ts");
  const verdict = await auditProjectChain(projectId);
  console.log(`\nHash chain re-checked from the database: ${verdict.valid ? "VALID" : "BROKEN"}, ${verdict.checked} record(s)${verdict.brokenAt ? `, first break at record ${verdict.brokenAt}` : ""}`);
} catch (err) {
  console.log(`\nHash chain re-check could not run: ${String(err).slice(0, 160)}`);
}
process.exit(0);
