// Deploy-with-retry for the clone flow (2026-09-06, real bug reproduced
// TWICE in the same spot): `docker compose up -d --build` failed both times
// with the identical error — "SystemError: spawnSync C:\WINDOWS\system32\
// cmd.exe ETIMEDOUT" — inside the automated route's execSync call. Both
// times, manually re-running the exact same command immediately after
// succeeded in under 90 seconds (once even under 20s) — the build itself is
// fast; this is a transient Windows process-spawn glitch (execSync always
// shells through cmd.exe on Windows), not a genuinely slow build. Raising
// the timeout wouldn't fix a spawn that never establishes; a bounded retry
// does, matching this codebase's existing pattern for exactly this class of
// "transient infra hiccup, not a real logic bug" failure (see
// MAX_CONSECUTIVE_TRANSPORT_FAILURES in packages/agent-runtime/src/loop.ts).
import { execSync } from "node:child_process";
import { stripRestartPoliciesInFile } from "../../packages/agent-runtime/src/tools/compose-ports.ts";

// Deliberately narrow: only the exact real failure shape seen live. A
// genuine build failure (npm/tsc/next erroring inside the container) must
// never be treated as transient — masking it behind a retry would hide a
// real bug instead of surfacing it honestly.
export function isTransientSpawnError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes("ETIMEDOUT") && msg.includes("spawnSync");
}

// 2026-10-18 (Leafkeeper run): the images built, then "docker compose up" failed because Docker had no network
// addresses left — every project leaves a network behind, and the default pools hold about thirty. Unused networks
// (none of their containers exist) are safe to remove; the project's data lives in volumes, which are not touched.
export function isNetworkPoolExhausted(err: unknown): boolean {
  return String(err).includes("all predefined address pools have been fully subnetted");
}

export interface DeployWithRetryDeps {
  execFn?: (command: string) => string;
  maxAttempts?: number;
}

export async function deployWithRetry(composePath: string, deps: DeployWithRetryDeps = {}): Promise<void> {
  const execFn = deps.execFn ?? ((command: string) => execSync(command, { encoding: "utf-8", timeout: 300_000 }));
  const maxAttempts = deps.maxAttempts ?? 2;
  const command = `docker compose -f "${composePath}" up -d --build`;
  // No auto-start: a cloned compose file may still carry a restart policy (2026-10-08).
  try { stripRestartPoliciesInFile(composePath); } catch { /* best effort */ }

  let lastErr: unknown;
  let pruned = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      execFn(command);
      return;
    } catch (err) {
      lastErr = err;
      if (!pruned && isNetworkPoolExhausted(err)) {
        pruned = true;
        console.log("[clone-deploy] Docker has no network addresses left — removing unused networks and retrying once");
        try {
          execFn("docker network prune -f");
        } catch {
          throw err;
        }
        execFn(command);
        return;
      }
      if (attempt < maxAttempts && isTransientSpawnError(err)) {
        console.log(`[clone-deploy] attempt ${attempt} hit a transient spawn error, retrying: ${String(err).slice(0, 200)}`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
