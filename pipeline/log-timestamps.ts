// Time on every worker log line (2026-10-25, brewline2): the log had no times, so the longest step of the build (the deploy and
// live review, 106 of 190 minutes) could not be split into its parts afterwards. Times are UTC, like the workflow history.
const METHODS = ["log", "info", "warn", "error"] as const;

export function installLogTimestamps(target: Console = console, now: () => Date = () => new Date()): () => void {
  const originals = new Map<(typeof METHODS)[number], (...args: unknown[]) => void>();
  for (const m of METHODS) {
    const original = target[m].bind(target) as (...args: unknown[]) => void;
    originals.set(m, target[m] as unknown as (...args: unknown[]) => void);
    target[m] = ((...args: unknown[]) => {
      const stamp = now().toISOString().slice(11, 19);
      original(stamp, ...args); // arguments untouched, so errors and objects still print in full
    }) as never;
  }
  return () => {
    for (const m of METHODS) target[m] = originals.get(m)! as never;
  };
}
