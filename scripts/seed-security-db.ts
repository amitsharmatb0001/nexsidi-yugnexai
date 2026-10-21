// Fills the security pattern database (patent claim 8).
//
//   bun scripts/seed-security-db.ts                         # the built-in code patterns and package advisories
//   bun scripts/seed-security-db.ts --osv GHSA-xxxx,GHSA-yyyy   # also import these entries live from osv.dev
//
// Re-running is safe: patterns are updated by key and advisories already present are left alone.
import { SEED_PATTERNS, SEED_ADVISORIES, importOsv, type Advisory } from "../packages/agent-runtime/src/security/pattern-scan.ts";

async function main() {
  const { upsertSecurityPatterns, addSecurityAdvisories } = await import("../packages/db/src/index.ts");
  const patterns = await upsertSecurityPatterns(SEED_PATTERNS);
  const advisories: Advisory[] = [...SEED_ADVISORIES];
  const i = process.argv.indexOf("--osv");
  if (i >= 0) {
    for (const id of (process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      const res = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
      if (!res.ok) {
        console.error(`osv.dev has no entry ${id} (answered ${res.status}); skipped`);
        continue;
      }
      const imported = importOsv(await res.json());
      console.log(`${id}: ${imported.length} advisory row(s) for npm packages`);
      advisories.push(...imported);
    }
  }
  const added = await addSecurityAdvisories(advisories);
  console.log(`Code patterns written: ${patterns}. Advisories offered: ${advisories.length}, new: ${added}.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(`Failed: ${String(err instanceof Error ? err.message : err)}`);
  process.exit(1);
});
