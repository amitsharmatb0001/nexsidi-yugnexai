// The curriculum (patent claim 4): training starts with obvious defects and moves to subtle ones as the checker gets better.
//
// After each round the catch rate (defects found / defects planted) at the current level is looked at over the last two
// rounds at that level. 80% or more moves the checker up a level, under 40% moves it down, anything between stays. With fewer
// than two rounds at the level there is nothing to judge yet. Levels run from 1 (obvious) to 5 (subtle).
import type { Level } from "./mutations.ts";

export interface RoundResult {
  level: Level;
  planted: number;
  caught: number;
}

export const catchRate = (rounds: RoundResult[]): number => {
  const planted = rounds.reduce((s, r) => s + r.planted, 0);
  return planted === 0 ? 0 : rounds.reduce((s, r) => s + r.caught, 0) / planted;
};

export function nextLevel(current: Level, history: RoundResult[], opts: { up?: number; down?: number; window?: number } = {}): { level: Level; reason: string } {
  const up = opts.up ?? 0.8;
  const down = opts.down ?? 0.4;
  const window = opts.window ?? 2;
  const here = history.filter((r) => r.level === current).slice(-window);
  if (here.length < window) return { level: current, reason: `not enough rounds at level ${current} yet (${here.length} of ${window})` };
  if (here.every((r) => r.planted === 0)) return { level: current, reason: "nothing was planted in those rounds" };
  const rate = catchRate(here);
  const pct = `${Math.round(rate * 100)}%`;
  if (rate >= up) return current === 5 ? { level: 5, reason: `${pct} caught at the top level` } : { level: (current + 1) as Level, reason: `${pct} caught at level ${current}: moving up` };
  if (rate < down) return current === 1 ? { level: 1, reason: `${pct} caught at the lowest level` } : { level: (current - 1) as Level, reason: `${pct} caught at level ${current}: moving down` };
  return { level: current, reason: `${pct} caught at level ${current}: staying` };
}
