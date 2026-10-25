// Alarm watcher for a build's worker log (2026-10-25, brewline2). Prints one line for each failure pattern seen in the builds the
// moment the log writes it, so it is raised on the spot instead of after the build stops. Use with a monitor:
//   bun pipeline/watch-alarms.ts <worker log file>
import { existsSync, readFileSync, statSync } from "node:fs";

const STAMP = /^\d{2}:\d{2}:\d{2} /;

export function alarmFor(rawLine: string): string | null {
  const line = rawLine.replace(STAMP, "").trim();
  const call = line.match(/\[call-time:[a-z0-9]+\] (\S+) (\S+) FAILED in ([0-9.]+)s/);
  if (call) return `ALARM review/model call FAILED after ${call[3]}s: ${call[1]} on ${call[2]}`;
  if (/returned 429/.test(line)) return "ALARM model service answered 429 (shared pool is busy; the call is retried elsewhere)";
  if (/\[activity:escalate\]/.test(line)) return `ALARM ESCALATED to a human: ${line.slice(0, 120)}`;
  if (/not checked|NOT CHECKED/.test(line) && !/^\s*$/.test(line)) return `ALARM NOT CHECKED: ${line.slice(0, 160)}`;
  if (/did not (?:complete|finish)|review-incomplete/.test(line)) return `ALARM ${line.slice(0, 160)}`;
  if (/Live retest failed|TEST DATA LEFT|budget_exceeded|Stuck loop detected|stopping — every fix/.test(line)) return `ALARM ${line.slice(0, 160)}`;
  if (/\bFAILED\b/.test(line)) return `ALARM ${line.slice(0, 160)}`;
  if (/threw:|failed inside the tool/.test(line)) return `ALARM ${line.slice(0, 160)}`;
  return null;
}

/** The same alarm repeating inside the window is shown once; the next time it shows says how many times it happened. */
export class AlarmThrottle {
  private seen = new Map<string, { at: number; hidden: number }>();
  constructor(private readonly windowMs = 60_000, private readonly now: () => number = Date.now) {}

  offer(alarm: string): string | null {
    const t = this.now();
    const prev = this.seen.get(alarm);
    if (prev && t - prev.at < this.windowMs) {
      prev.hidden++;
      return null;
    }
    const times = (prev?.hidden ?? 0) + (prev ? 1 : 0);
    this.seen.set(alarm, { at: t, hidden: 0 });
    return times > 1 ? `${alarm} (${times} times in the last minute)` : alarm;
  }
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file || !existsSync(file)) {
    console.error("usage: bun pipeline/watch-alarms.ts <worker log file>");
    process.exit(1);
  }
  const throttle = new AlarmThrottle();
  let offset = 0;
  const poll = () => {
    const size = statSync(file).size;
    if (size < offset) offset = 0;
    if (size > offset) {
      const text = readFileSync(file, "utf-8").slice(offset);
      offset = size;
      for (const line of text.split("\n")) {
        const alarm = alarmFor(line);
        const shown = alarm ? throttle.offer(alarm) : null;
        if (shown) console.log(`${new Date().toISOString().slice(11, 19)} ${shown}`);
      }
    }
  };
  offset = statSync(file).size; // only what is written from now on
  setInterval(poll, 2000);
}
