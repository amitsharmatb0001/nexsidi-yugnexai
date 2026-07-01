import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const rows = await db.execute(sql`SELECT agent_name, score, findings FROM qa_results WHERE project_id='test9004' AND iteration=2 ORDER BY agent_name`);
for (const row of rows.rows) {
  console.log(`\n=== ${row.agent_name} score=${row.score} ===`);
  const findings = Array.isArray(row.findings) ? row.findings : JSON.parse(row.findings as string);
  for (const f of findings) console.log(`  [${f.severity}] ${f.description}`);
}
await pool.end();
