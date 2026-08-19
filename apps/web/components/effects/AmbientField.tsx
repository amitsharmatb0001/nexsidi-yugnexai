"use client";

import { field as s } from "./AmbientField.styles";

// Fixed presets rather than Math.random(): server and client must render the
// identical markup on first paint (React hydration), so any per-particle
// randomness has to be baked in ahead of time, not rolled at render time.
// Negative delays start each particle mid-cycle so the field looks alive
// immediately on mount instead of every dot rising in lockstep from zero.
const PARTICLES = [
  { left: "4%", duration: 22, delay: -3 },
  { left: "11%", duration: 26, delay: -14 },
  { left: "19%", duration: 19, delay: -8 },
  { left: "27%", duration: 24, delay: -19 },
  { left: "35%", duration: 21, delay: -1 },
  { left: "43%", duration: 27, delay: -11 },
  { left: "52%", duration: 20, delay: -17 },
  { left: "60%", duration: 25, delay: -6 },
  { left: "68%", duration: 23, delay: -21 },
  { left: "76%", duration: 19, delay: -9 },
  { left: "83%", duration: 26, delay: -4 },
  { left: "91%", duration: 22, delay: -16 },
  { left: "8%", duration: 29, delay: -24 },
  { left: "58%", duration: 28, delay: -13 },
];

/**
 * A faint field of rising particles, absolutely positioned behind whatever
 * the caller renders on top of it. The caller's root needs `position:
 * relative` (or similar) for the `inset: 0` layer to anchor correctly.
 */
export default function AmbientField() {
  return (
    <div className={s.container} aria-hidden="true">
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className={s.particle}
          style={{ left: p.left, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }}
        />
      ))}
    </div>
  );
}
