"use client";

import { STAGES, stageIndexFor } from "../../lib/stages";
import { pipeline3d as s } from "./Pipeline3D.styles";

/**
 * The run, shown as depth rather than as a progress bar.
 *
 * Stages sit on a shared perspective plane: completed ones recede, the
 * current one stands at the front. That gives the pipeline a sense of
 * position — how far in, how much left — which a flat row of dots cannot,
 * without adding a 3D library or a canvas.
 *
 * Rotation is fixed. Anything that spins or drifts on its own would be
 * decoration, and this sits in the title bar where it is glanced at, not
 * watched.
 */
export default function Pipeline3D({
  stage,
  failed,
  done,
}: {
  stage: string;
  failed?: boolean;
  done?: boolean;
}) {
  const current = done ? STAGES.length - 1 : stageIndexFor(stage);

  return (
    <div className={s.stage3d} role="img" aria-label={`Pipeline stage: ${stage}`}>
      <div className={s.plane}>
        {STAGES.map((st, i) => {
          const offset = i - (current < 0 ? 0 : current);
          const isCurrent = offset === 0;
          const isPast = offset < 0;

          // Past stages sink back and dim; upcoming ones sit slightly forward
          // and dimmer still, so the eye lands on the current one.
          const depth = isPast ? Math.max(offset * 14, -46) : Math.min(offset * -10, 0);
          const opacity = isCurrent ? 1 : isPast ? 0.42 : 0.2;

          return (
            <div
              key={st.key}
              className={[
                s.slab,
                isCurrent ? s.slabCurrent : "",
                isPast ? s.slabPast : "",
                isCurrent && failed ? s.slabFail : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                transform: `translateZ(${depth}px)`,
                opacity,
              }}
              title={st.label}
            >
              <span className={s.slabLabel}>{st.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
