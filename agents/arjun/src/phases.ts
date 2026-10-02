// Build phases on builder tasks (Part C.2 of the agentic planner plan,
// approved by Amit, 2 Oct 2026). Agents work one focused phase at a time so
// they do not burn out and stay relevant. The planner decides the phases and
// lists each phase's pages, endpoints and tables; here every builder task is
// tagged with its phase in code — a deterministic match cannot skip or
// invent work the way a model tagging tasks could.
//
// - Frontend tasks: the phase whose page maps to one of the task's files.
// - Backend tasks: the phase whose resources (endpoint path, page, table
//   names) appear in the task — file names count three times the
//   description, because a dashboard task may *mention* invoices.
// - Shared pieces with no match (server setup, layout, header): phase 1.
// - Database: the whole schema in phase 1, so every later phase relies on it.
//
// Every task also gets a size (its file count) that sizes each phase's step
// budget — no fixed number of steps.

export interface PhaseTask {
  description: string;
  outputFiles: string[];
  phase?: number; // 1-based, in the plan's phase order
  size?: number;
}

export interface PlanPhase {
  name: string;
  goal: string;
  pages: string[];
  endpoints: string[];
  tables: string[];
}

function pageFile(urlPath: string): string {
  if (urlPath === "/") return "app/page.tsx";
  if (/^\/(sign-?in)$/i.test(urlPath)) return "app/(auth)/sign-in/page.tsx";
  if (/^\/(sign-?up)$/i.test(urlPath)) return "app/(auth)/sign-up/page.tsx";
  const clean = urlPath.replace(/\/+$/, "").replace(/\/:([A-Za-z_][A-Za-z0-9_]*)/g, "/[$1]");
  return `app${clean}/page.tsx`;
}

/** "invoice_items" → "invoice item"; "Clients" → "client" — a stem matched with or without a plural ending. */
function stem(word: string): string {
  return word.toLowerCase().replace(/[_-]+/g, " ").replace(/(ies)$/, "y").replace(/(es|s)$/, "").trim();
}

function phaseKeywords(ph: PlanPhase): string[] {
  const words = new Set<string>();
  for (const e of ph.endpoints ?? []) {
    const path = e.trim().split(/\s+/).slice(1).join(" ");
    const seg = path.replace(/^\/?api\/(v\d+\/)?/i, "").split("/")[0];
    if (seg) words.add(stem(seg));
  }
  for (const p of ph.pages ?? []) {
    const seg = p.replace(/^\//, "").split("/")[0];
    if (seg && !seg.startsWith(":")) words.add(stem(seg));
  }
  for (const t of ph.tables ?? []) words.add(stem(t));
  return [...words].filter((w) => w.length > 1);
}

/** Text as separate lower-case words: camelCase, paths, dots and underscores split. */
function words(text: string): string {
  return ` ${text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
}

function hits(text: string, keyword: string): number {
  const re = new RegExp(` ${keyword.replace(/ /g, " ")}(s|es)? `, "g");
  return (text.match(re) ?? []).length;
}

function bestPhase(task: PhaseTask, keywords: string[][]): number {
  const files = words(task.outputFiles.join(" "));
  const desc = words(task.description);
  let best = 0;
  let bestScore = 0;
  keywords.forEach((kws, i) => {
    const score = kws.reduce((sum, k) => sum + 3 * hits(files, k) + hits(desc, k), 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best + 1;
}

export function assignTaskPhases(
  plan: { shubhamTasks: PhaseTask[]; aanyaTasks: PhaseTask[]; pranavTasks: PhaseTask[] },
  phases: PlanPhase[],
): void {
  if (!phases.length) return;
  const keywords = phases.map(phaseKeywords);
  const pageFiles = phases.map((ph) => new Set((ph.pages ?? []).map(pageFile)));
  const size = (t: PhaseTask) => Math.max(1, t.outputFiles.length);

  for (const t of plan.aanyaTasks) {
    const byPage = pageFiles.findIndex((files) => t.outputFiles.some((f) => files.has(f.replace(/\\/g, "/"))));
    t.phase = byPage >= 0 ? byPage + 1 : bestPhase(t, keywords);
    t.size = size(t);
  }
  for (const t of plan.shubhamTasks) {
    t.phase = bestPhase(t, keywords);
    t.size = size(t);
  }
  for (const t of plan.pranavTasks) {
    t.phase = 1;
    t.size = size(t);
  }
}
