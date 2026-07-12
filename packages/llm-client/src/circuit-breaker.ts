export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface Breaker {
  state: CircuitState;
  failures: number;
  lastFailureMs: number;
  probeSuccesses: number;
}

const FAILURE_THRESHOLD   = 5;
const OPEN_TIMEOUT_MS     = 60_000; // 1 min before trying HALF_OPEN
const PROBE_SUCCESS_NEEDED = 2;

const breakers = new Map<string, Breaker>();

function get(key: string): Breaker {
  return breakers.get(key) ?? { state: "CLOSED", failures: 0, lastFailureMs: 0, probeSuccesses: 0 };
}

export function canRequest(key: string, timeoutMs: number = OPEN_TIMEOUT_MS): boolean {
  const b = get(key);
  if (b.state === "CLOSED") return true;
  if (b.state === "OPEN") {
    if (Date.now() - b.lastFailureMs > timeoutMs) {
      b.state = "HALF_OPEN";
      b.probeSuccesses = 0;
      breakers.set(key, b);
      return true; // allow one probe
    }
    return false;
  }
  return true; // HALF_OPEN: allow probe
}

export function recordSuccess(key: string): void {
  const b = get(key);
  if (b.state === "HALF_OPEN") {
    b.probeSuccesses += 1;
    if (b.probeSuccesses >= PROBE_SUCCESS_NEEDED) {
      b.state = "CLOSED";
      b.failures = 0;
    }
  } else {
    b.failures = Math.max(0, b.failures - 1); // gradual recovery in CLOSED
  }
  breakers.set(key, b);
}

export function recordFailure(key: string): void {
  const b = get(key);
  b.failures += 1;
  b.lastFailureMs = Date.now();
  if (b.failures >= FAILURE_THRESHOLD || b.state === "HALF_OPEN") {
    b.state = "OPEN";
    b.probeSuccesses = 0;
  }
  breakers.set(key, b);
}

export function getState(key: string): CircuitState {
  return get(key).state;
}

// 2026-07-11: real bug found live — a caller blocked by an OPEN circuit threw
// immediately (see gemini.ts's original canRequest()-then-throw pattern),
// turning a self-healing condition (the breaker auto-transitions to HALF_OPEN
// after timeoutMs) into an unrecoverable pipeline-ending exception. Waits out
// the REMAINING cooldown only — never longer than timeoutMs, never if the
// circuit is already CLOSED or the cooldown already elapsed — then returns,
// leaving the actual retry decision (one HALF_OPEN probe) to canRequest().
export async function waitForCircuit(key: string, timeoutMs: number = OPEN_TIMEOUT_MS): Promise<void> {
  if (canRequest(key, timeoutMs)) return;
  const b = get(key);
  // +10ms safety margin: setTimeout is a MINIMUM delay, not exact — timer
  // rounding (notably on Windows, ~15ms granularity) can otherwise land the
  // re-check's elapsed time exactly ON the boundary, where canRequest's
  // strict `>` comparison stays false and the caller waits again for nothing.
  const remainingMs = timeoutMs - (Date.now() - b.lastFailureMs) + 10;
  if (remainingMs > 0) {
    await new Promise((r) => setTimeout(r, remainingMs));
  }
  // Re-check so the OPEN -> HALF_OPEN transition is applied now, using the
  // same timeoutMs — otherwise a caller's later plain canRequest(key) (real
  // default window) would see a state that hasn't been flipped yet.
  canRequest(key, timeoutMs);
}

// Visible for monitoring (nice-to-have #11)
export function getAllStates(): Record<string, CircuitState> {
  return Object.fromEntries([...breakers.entries()].map(([k, v]) => [k, v.state]));
}
