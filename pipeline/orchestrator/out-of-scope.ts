// Findings that ask for an endpoint nobody requested (2026-10-22). On the Trailhead rerun the live reviewer kept reporting
// "missing" booking cancellation and GET /api/v1/auth/me; each was routed to a builder, disputed and settled "not true",
// but only after costing a round. Before routing, a finding that says an endpoint is missing is dropped when every endpoint
// it names is outside the approved API contract and no frontend file calls it. A missing endpoint the frontend does call is
// a real broken call and is kept. Deterministic; no model call.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type F = { file?: string; issue?: string; detail?: string };

const MISSING = /\b(missing|does not (?:expose|exist|implement|provide)|no (?:route|endpoint|api)|not implemented|lacks?|inability|cannot|unable to)\b/i;
// "GET /api/x", "POST/DELETE /api/x/:id", "DELETE/PATCH http://localhost:3301/api/x", "GET '/api/x'"
const METHOD = "(?:GET|POST|PUT|PATCH|DELETE)";
const ENDPOINT = new RegExp(`\\b(${METHOD}(?:\\/${METHOD})*)\\s+['"\`]?(?:https?:\\/\\/[^/\\s'"\`]+)?(\\/api\\/[A-Za-z0-9_\\-/:{}$.]+)`, "g");

const normalize = (p: string) =>
  p.replace(/\/+$/, "").split("/").map((s) => (/^(:|\{|\$|\[)/.test(s) ? "*" : s.toLowerCase())).join("/");

function contractPaths(buildDir: string): Set<string> | null {
  const file = join(buildDir, "api-contract.json");
  if (!existsSync(file)) return null;
  try {
    const c = JSON.parse(readFileSync(file, "utf-8")) as { endpoints?: Array<{ method?: string; path?: string }> };
    return new Set((c.endpoints ?? []).filter((e) => e.path).map((e) => `${String(e.method ?? "").toUpperCase()} ${normalize(e.path!)}`));
  } catch {
    return null;
  }
}

function frontendSource(buildDir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    let names: string[];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      if (["node_modules", ".next", "public"].includes(n)) continue;
      const full = join(d, n);
      try {
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx)$/.test(n)) out.push(readFileSync(full, "utf-8"));
      } catch { /* unreadable: skipped */ }
    }
  };
  walk(join(buildDir, "frontend"));
  return out.join("\n");
}

/** The fixed part of a path the frontend would write in a string: up to the first parameter. */
const fixedPrefix = (path: string) => path.split("/").filter((s) => s && !/^(:|\{|\$|\[)/.test(s)).join("/");

export function dropOutOfScopeFindings<T extends F>(findings: T[], buildDir: string): { kept: T[]; dropped: Array<{ finding: T; reason: string }> } {
  const contract = contractPaths(buildDir);
  if (!contract || findings.length === 0) return { kept: findings, dropped: [] };
  const front = frontendSource(buildDir);
  const kept: T[] = [];
  const dropped: Array<{ finding: T; reason: string }> = [];
  for (const finding of findings) {
    const text = String(finding.issue ?? finding.detail ?? "");
    const named = [...text.matchAll(ENDPOINT)].flatMap((m) =>
      m[1]!.toUpperCase().split("/").map((method) => ({ method, path: m[2]!.replace(/\.{2,}$/, "") })));
    if (named.length === 0 || !MISSING.test(text)) { kept.push(finding); continue; }
    // Approved endpoints are often named as context ("only implements GET /api/v1/bookings"); what decides is whether the
    // finding asks for one outside the contract that no page calls.
    const isCalled = (path: string) => {
      const prefix = fixedPrefix(path);
      return prefix.length > 0 && [`'`, `"`, "`", "?", "/"].some((end) => front.includes(`/${prefix}${end}`));
    };
    const outside = named.filter((e) => !contract.has(`${e.method} ${normalize(e.path)}`));
    const calledByFrontend = outside.some((e) => isCalled(e.path));
    if (outside.length > 0 && !calledByFrontend) {
      dropped.push({ finding, reason: `asks for ${[...new Set(outside.map((e) => `${e.method} ${e.path}`))].join(", ")}, which the approved API contract does not have and no page calls` });
    } else {
      kept.push(finding);
    }
  }
  return { kept, dropped };
}
