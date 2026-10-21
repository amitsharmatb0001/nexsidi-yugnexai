// Database access for the security pattern database (patent claim 8). Plain row shapes, so this package does not depend on the scanner.
import { db } from "./client.ts";
import { securityPatterns, securityAdvisories } from "./schema.ts";
import { sql } from "drizzle-orm";

export interface PatternRow {
  key: string;
  source: "owasp" | "cwe" | "internal";
  category: string;
  cwe: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  pattern: string;
  flags?: string;
  pathRegex?: string;
  description: string;
  remediation: string;
  enabled?: boolean;
}
export interface AdvisoryRow {
  id: string;
  ghsa?: string;
  package: string;
  range: string;
  fixedIn: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  summary: string;
}

export async function loadSecurityPatterns(): Promise<PatternRow[]> {
  const rows = await db.select().from(securityPatterns);
  return rows.map((r) => ({ key: r.key, source: r.source as PatternRow["source"], category: r.category, cwe: r.cwe, severity: r.severity as PatternRow["severity"], pattern: r.pattern, flags: r.flags ?? undefined, pathRegex: r.pathRegex ?? undefined, description: r.description, remediation: r.remediation, enabled: r.enabled }));
}

export async function loadSecurityAdvisories(): Promise<AdvisoryRow[]> {
  const rows = await db.select().from(securityAdvisories);
  return rows.map((r) => ({ id: r.id, ghsa: r.ghsa ?? undefined, package: r.package, range: r.range, fixedIn: r.fixedIn, severity: r.severity as AdvisoryRow["severity"], summary: r.summary }));
}

/** Adds or updates patterns by key. Returns how many rows were written. */
export async function upsertSecurityPatterns(rows: PatternRow[]): Promise<number> {
  for (const r of rows) {
    const values = { key: r.key, source: r.source, category: r.category, cwe: r.cwe, severity: r.severity, pattern: r.pattern, flags: r.flags ?? null, pathRegex: r.pathRegex ?? null, description: r.description, remediation: r.remediation, enabled: r.enabled ?? true };
    await db.insert(securityPatterns).values(values).onConflictDoUpdate({ target: securityPatterns.key, set: { ...values, key: sql`excluded.key` } });
  }
  return rows.length;
}

/** Adds advisories that are not already there (same id, package and range). Returns how many were new. */
export async function addSecurityAdvisories(rows: AdvisoryRow[]): Promise<number> {
  let added = 0;
  for (const r of rows) {
    const out = await db.insert(securityAdvisories).values({ id: r.id, ghsa: r.ghsa ?? null, package: r.package, range: r.range, fixedIn: r.fixedIn, severity: r.severity, summary: r.summary }).onConflictDoNothing().returning({ id: securityAdvisories.id });
    added += out.length;
  }
  return added;
}
