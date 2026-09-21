import type { BuildPlan } from "./PlanPreview";

// Pure and exported for direct unit testing — mirrors PlanPreview.tsx's own
// section order and field fallbacks (name ?? tableName, fields ?? columns)
// exactly, so the exported document always matches what's on screen.
export function planToMarkdown(plan: BuildPlan): string {
  const lines: string[] = [];
  const design = plan.designBrief;
  const workstreams: Array<{ label: string; tasks: BuildPlan["aanyaTasks"] }> = [
    { label: "Frontend", tasks: plan.aanyaTasks },
    { label: "Backend", tasks: plan.shubhamTasks },
    { label: "Database", tasks: plan.pranavTasks },
  ].filter((w) => w.tasks?.length);

  lines.push(`# ${plan.appName}`, "");
  if (plan.appDescription) lines.push(plan.appDescription, "");

  let n = 0;

  if (design && (design.mood || design.palette?.length || design.layoutConcept)) {
    lines.push(`## ${String(++n).padStart(2, "0")}. Design Direction`, "");
    if (design.mood) lines.push(design.mood, "");
    if (design.palette?.length) {
      lines.push("| Token | Hex |", "|---|---|");
      for (const c of design.palette) lines.push(`| ${c.name} | \`${c.hex}\` |`);
      lines.push("");
    }
    if (design.typography?.display || design.typography?.body) {
      if (design.typography.display) lines.push(`**Display:** ${design.typography.display}  `);
      if (design.typography.body) lines.push(`**Body:** ${design.typography.body}  `);
      lines.push("");
    }
    if (design.layoutConcept) lines.push(design.layoutConcept, "");
  }

  if (plan.features?.length) {
    lines.push(`## ${String(++n).padStart(2, "0")}. Features`, "");
    for (const f of plan.features) {
      lines.push(`### ${f.name}`, "", f.description, "");
      if (f.userStories?.length) {
        for (const story of f.userStories) lines.push(`- ${story}`);
        lines.push("");
      }
    }
  }

  if (plan.apiContract?.endpoints?.length) {
    lines.push(`## ${String(++n).padStart(2, "0")}. API Contract`, "");
    if (plan.apiContract.baseUrl) lines.push(`\`${plan.apiContract.baseUrl}\``, "");
    lines.push("| Method | Path | Description | Auth |", "|---|---|---|---|");
    for (const ep of plan.apiContract.endpoints) {
      lines.push(`| ${ep.method} | \`${ep.path}\` | ${ep.description} | ${ep.auth ? "Required" : "Public"} |`);
    }
    lines.push("");
  }

  if (plan.dbSchema?.tables?.length) {
    lines.push(`## ${String(++n).padStart(2, "0")}. Database Schema`, "");
    for (const t of plan.dbSchema.tables) {
      const tableName = t.name ?? t.tableName ?? "table";
      const fields = t.fields ?? t.columns ?? [];
      lines.push(`### ${tableName}`, "", "| Field | Type | Nullable | Default |", "|---|---|---|---|");
      for (const f of fields) {
        const nameCell = f.primaryKey ? `🔑 ${f.name}` : f.name;
        lines.push(`| ${nameCell} | ${f.type} | ${f.nullable ? "yes" : "no"} | ${f.default ?? "—"} |`);
      }
      lines.push("");
    }
  }

  if (workstreams.length) {
    lines.push(`## ${String(++n).padStart(2, "0")}. Build Plan`, "");
    for (const { label, tasks } of workstreams) {
      lines.push(`### ${label}`, "");
      for (const t of tasks!) {
        lines.push(`- ${t.description}`);
        if (t.outputFiles?.length) {
          for (const f of t.outputFiles) lines.push(`  - \`${f}\``);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

// Filesystem-safe filename derived from the app name — falls back to a
// generic name when appName is empty/whitespace-only rather than producing
// an empty or all-dashes filename.
export function planMarkdownFilename(plan: BuildPlan): string {
  const slug = plan.appName?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "project-plan"}.md`;
}
