// P4 (live NexTech run, 2026-07-25): real, severe bug found live — a
// generated app's Postgres tables (contact_inquiries, users, service_
// requests, ...) turned up INSIDE NexSidi's own platform database
// (confirmed via `docker exec ... psql -c '\dt'`), and a live INSERT during
// nextech3's own self-verification failed with a real Postgres error
// ("column does not exist") because a DIFFERENT project's migration had
// already created that table with a different schema. Root cause: both
// execRunCommand (command.ts) and execDockerCompose (docker.ts) spawned
// every agent shell command with `env: { ...process.env, ... }` — the
// FULL worker process environment, including the platform's own
// DATABASE_URL. A generated backend's `dotenv/config` call does NOT
// override an already-set process.env var by default, so the platform's
// DATABASE_URL silently won over the project's own .env every time, for
// every generated project, in every self-verification run — a real data-
// isolation gap touching CLAUDE.md's Layer 2 (file/execution isolation)
// and Patent Claim 5 (4-tier sandbox isolation) directly.
//
// Fix: an explicit BLOCKLIST (not an allowlist) of platform secrets/config
// that must never reach an agent-sandboxed command. A blocklist here is
// deliberately chosen over an allowlist — an allowlist risks silently
// breaking legitimate tool functionality (PATH, npm registry config, git
// credentials helpers, etc.) that this module has no complete inventory
// of; a blocklist only needs to enumerate what's actually dangerous.
export const SANDBOX_BLOCKED_ENV_VARS: readonly string[] = [
  // Platform database/cache — the exact leak this fix closes.
  "DATABASE_URL",
  "REDIS_URL",
  // NexSidi's own platform auth/secrets — never relevant to a generated app.
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "CHAIN_PRIVATE_KEY_PATH",
  "PROMPT_AUDIT_KEY",
  "GITHUB_TOKEN",
  "NVD_WEBHOOK_SECRET",
  "GHSA_WEBHOOK_SECRET",
  // LLM provider credentials — agents call these APIs via the harness
  // itself (fetch, not shelling out); a sandboxed command never legitimately
  // needs them, and leaking them would let a compromised/malicious generated
  // command exfiltrate or spend against NexSidi's own API budget.
  "ANTHROPIC_API_KEY",
  "NIM_API_KEY",
  "FIRECRAWL_API_KEY",
  // NexSidi platform's own listen port — a generated app reading
  // process.env.PORT for ITS OWN server would silently bind to the
  // platform API's port instead of its assigned backendPort/frontendPort.
  "PORT",
];

// Case-insensitive on Windows (env var names are case-insensitive there),
// case-sensitive elsewhere — matches Node's own process.env behavior per
// platform, so this can't be bypassed by a differently-cased key surviving
// on Windows while the blocklist entry was written in a different case.
function isBlocked(key: string): boolean {
  const blockedSet = process.platform === "win32" ? SANDBOX_BLOCKED_ENV_VARS.map((k) => k.toUpperCase()) : SANDBOX_BLOCKED_ENV_VARS;
  const compareKey = process.platform === "win32" ? key.toUpperCase() : key;
  return blockedSet.includes(compareKey);
}

// Pure and exported for direct unit testing without spawning a real process.
export function buildSandboxEnv(extra: Record<string, string> = {}): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (isBlocked(key)) continue;
    scrubbed[key] = value;
  }
  return { ...scrubbed, ...extra };
}
