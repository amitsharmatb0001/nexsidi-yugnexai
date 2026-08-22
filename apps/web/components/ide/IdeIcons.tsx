/**
 * The IDE's own icon set — 16x16, single-stroke, geometric. Built for this
 * redesign because the prototype this workspace is based on
 * (apps/prototype-ui/app/components/IdeWorkspace.tsx) used emoji as icons
 * throughout (📁🔍🌿🌐🔲⚙️📎🎤📥✕▲▼) — fine as a wireframe placeholder, not
 * as a shipped visual language. Every glyph here is drawn from the same
 * primitives (rounded rect, arc, straight stroke) so the set reads as one
 * family rather than a mix of borrowed styles.
 *
 * All icons render at currentColor and a fixed stroke width so they scale
 * cleanly with font-size the way text does.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base(props: IconProps) {
  const { size = 16, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...rest,
  };
}

export function IconExplorer(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 4.5a1 1 0 0 1 1-1h3l1.2 1.6H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="m13 13-3-3" />
    </svg>
  );
}

export function IconChanges(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="4.5" cy="3.5" r="1.6" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="11.5" cy="8" r="1.6" />
      <path d="M4.5 5.1v5.8" />
      <path d="M4.5 6c0 3 2.5 2 5.5 2" />
    </svg>
  );
}

export function IconPreview(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12" />
      <path d="M8 2c1.8 1.7 2.8 3.8 2.8 6s-1 4.3-2.8 6c-1.8-1.7-2.8-3.8-2.8-6s1-4.3 2.8-6Z" />
    </svg>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.2" y="2.2" width="4.8" height="4.8" rx="1" />
      <rect x="9" y="2.2" width="4.8" height="4.8" rx="1" />
      <rect x="2.2" y="9" width="4.8" height="4.8" rx="1" />
      <rect x="9" y="9" width="4.8" height="4.8" rx="1" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 1.8v1.7M8 12.5v1.7M14.2 8h-1.7M3.5 8H1.8M12.3 3.7l-1.2 1.2M4.9 11.1l-1.2 1.2M12.3 12.3l-1.2-1.2M4.9 4.9 3.7 3.7" />
    </svg>
  );
}

export function IconAttach(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.5 3.5 4.8 9.2a2.4 2.4 0 0 0 3.4 3.4l5.7-5.7a3.8 3.8 0 0 0-5.4-5.4L2.8 7.2" />
    </svg>
  );
}

export function IconMic(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="1.6" width="4" height="7" rx="2" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
      <path d="M8 12v2.4M6 14.4h4" />
    </svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m2.2 8 11.6-5.6-4 11.4-2.4-4.8-4.8-2.4Z" />
      <path d="M7.4 8.6 13.8 2.4" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 5.5 8 10l4.5-4.5" />
    </svg>
  );
}

export function IconCollapseLeft(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.2" y="2.5" width="11.6" height="11" rx="1.4" />
      <path d="M6.2 2.5v11" />
      <path d="m9.8 6-2 2 2 2" />
    </svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2v8" />
      <path d="m4.5 7 3.5 3.5L11.5 7" />
      <path d="M2.5 12.5h11" />
    </svg>
  );
}

export function IconTerminal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4" />
      <path d="m4.5 6 2.4 2-2.4 2" />
      <path d="M8.2 10.5h3.3" />
    </svg>
  );
}

export function IconPlan(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.6" />
      <path d="m5 7.7 1.5 1.5L10.5 5.7" />
    </svg>
  );
}

export function IconContext(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2.5h6.2L13 5.3V13.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
      <path d="M10 2.5V5.3h3" />
      <path d="M5 8.2h6M5 10.6h4.2" />
    </svg>
  );
}

export function IconMaximize(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6" />
      <path d="M10 2.5h2.5a1 1 0 0 1 1 1V6" />
      <path d="M13.5 10v2.5a1 1 0 0 1-1 1H10" />
      <path d="M6 13.5H3.5a1 1 0 0 1-1-1V10" />
    </svg>
  );
}

export function IconMinimize(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 2.5V5a1 1 0 0 1-1 1H2.5" />
      <path d="M10 2.5V5a1 1 0 0 1 1 1h2.5" />
      <path d="M13.5 10H11a1 1 0 0 0-1 1v2.5" />
      <path d="M2.5 10H5a1 1 0 0 1 1 1v2.5" />
    </svg>
  );
}

export function IconCost(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 1.8v12.4" />
      <path d="M10.6 4.4c0-1-1.1-1.6-2.6-1.6-1.7 0-2.8.8-2.8 2s1 1.7 2.8 2c1.8.3 2.8.9 2.8 2.1 0 1.2-1.1 2-2.8 2-1.5 0-2.6-.6-2.6-1.6" />
    </svg>
  );
}
