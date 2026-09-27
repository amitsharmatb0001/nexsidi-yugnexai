// Files the pipeline writes about ITSELF into a project's build folder, as
// opposed to files belonging to the generated app: agent histories (full
// internal system prompts, internal agent names), run logs, QA bookkeeping,
// checkpoints and planner output. Paths are relative to the project root,
// POSIX-separated, and only the TOP level counts, so an app's own
// backend/logs/ is never mistaken for pipeline output.
//
// One definition, used everywhere a customer could otherwise see these:
// the IDE file tree/viewer/diff (apps/api/src/routes/artifacts.ts), the
// delivery .gitignore (tools/git.ts DELIVERY_GITIGNORE_LINES mirrors it),
// and Express Build, which must never carry another project's files
// (pipeline/orchestrator/clone-project.ts). Moved here from artifacts.ts
// 2026-09-27; the old history pattern ([a-z]+) missed hyphenated names like
// history-tilotma-reality-checker.json.
export function isPipelineBookkeeping(path: string): boolean {
  return (
    path === "logs" ||
    path.startsWith("logs/") ||
    path === "checkpoints" ||
    path.startsWith("checkpoints/") ||
    path.endsWith(".jsonl") ||
    /^history-[a-z0-9-]+\.json$/.test(path) ||
    path === "qa-submissions.json" ||
    path === "planner-plan.json"
  );
}
