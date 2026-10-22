// Where one build's money went, by agent and model, from agent_spend (recorded on every model call since 2026-10-22).
//
//   bun --env-file=.env scripts/spend-report.ts <projectId>
//
// The project total in token_spend is printed alongside: calls made before agent_spend existed are in the total only.
const projectId = process.argv[2];
if (!projectId) {
  console.error("usage: bun --env-file=.env scripts/spend-report.ts <projectId>");
  process.exit(1);
}
const { db } = await import("../packages/db/src/index.ts");
const { sql } = await import("drizzle-orm");
const rows = (await db.execute(sql`
  select agent, model, calls, tokens_in, tokens_out, cached_in, cost_usd
  from agent_spend where project_id = ${projectId} order by cost_usd desc`)) as unknown as Array<Record<string, string | number>>;
const total = (await db.execute(sql`select total_cost_usd from token_spend where project_id = ${projectId}`)) as unknown as Array<{ total_cost_usd: string }>;
const byAgent = rows.reduce((s, r) => s + Number(r.cost_usd), 0);
console.log(`Project ${projectId}: total $${Number(total[0]?.total_cost_usd ?? 0).toFixed(2)}, of which $${byAgent.toFixed(2)} is broken down by agent\n`);
for (const r of rows) {
  const share = byAgent > 0 ? (100 * Number(r.cost_usd)) / byAgent : 0;
  console.log(`${String(r.agent).padEnd(28)} ${String(r.model).padEnd(24)} $${Number(r.cost_usd).toFixed(2).padStart(6)}  ${share.toFixed(1).padStart(5)}%  calls=${r.calls}  in=${(Number(r.tokens_in) / 1e6).toFixed(2)}M  cached=${(Number(r.cached_in) / 1e6).toFixed(2)}M  out=${(Number(r.tokens_out) / 1e3).toFixed(0)}K`);
}
process.exit(0);
