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

export function canRequest(key: string): boolean {
  const b = get(key);
  if (b.state === "CLOSED") return true;
  if (b.state === "OPEN") {
    if (Date.now() - b.lastFailureMs > OPEN_TIMEOUT_MS) {
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

// Visible for monitoring (nice-to-have #11)
export function getAllStates(): Record<string, CircuitState> {
  return Object.fromEntries([...breakers.entries()].map(([k, v]) => [k, v.state]));
}
