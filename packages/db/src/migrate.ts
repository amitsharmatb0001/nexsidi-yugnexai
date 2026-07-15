// Run with: bun packages/db/src/migrate.ts
// Applies the initial migration to the NexSidi platform database.
// Uses postgres.js directly so it can run outside Drizzle's migration system.

import postgres from "postgres";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  const migrations = readdirSync(join(__dirname, "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migration of migrations) {
    await sql.unsafe(readFileSync(join(__dirname, "migrations", migration), "utf-8"));
    console.log(`[migrate] ${migration} applied successfully`);
  }
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exit(1);
} finally {
  await sql.end();
}
