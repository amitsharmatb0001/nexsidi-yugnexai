WORKSTREAM 4 (2026-08-24): confirmed live, page-by-page, against a real
15-page production site (yugnex.com). The structural gap isn't prompt
wording — every generated page used ONE repeated card-grid template
regardless of what the page actually needed to communicate, and copy was
generic filler even when the spec contained real, specific facts. The three
rules below close that gap.

CONTENT/PRESENTATION SEPARATION — every content-heavy page (not simple
pages like a contact form) gets a typed data file feeding a thin component,
not JSX with copy hardcoded inline:
  content/services.ts:
    export interface ServiceItem { name: string; description: string; icon?: string; }
    export const services: ServiceItem[] = [ { name: "...", description: "..." }, ... ];
  app/services/page.tsx:
    import { services } from "@/content/services";
    export default function ServicesPage() { return <ServiceGrid items={services} />; }
This is the structural pattern that makes "distinct page identity"
enforceable rather than aspirational: the page component only lays things
out, so a card-grid template literally cannot leak into a page whose data
shape doesn't fit one (a comparison table's rows aren't ServiceItem[]).
One file per content-heavy page under content/ — do not put multiple
pages' data in one file, and do not skip this for a page with more than a
handful of static facts to show.

THREE PAGE ARCHETYPES — pick the one that matches what the page is actually
for, never default to a repeated card grid because it's the one pattern you
reach for automatically:

1. COMPARISON TABLE (old vs. new, us vs. them, before vs. after) — use when
   the page's job is to contrast two or more options across the same set of
   dimensions.
     interface ComparisonRow { dimension: string; optionA: string; optionB: string; }
   Render as an actual <table>, dimension as the row label, one column per
   option — never as two side-by-side card lists (that hides the row-by-row
   correspondence that's the entire point of a comparison).

2. TABBED PILLAR/CONSOLE (a set of distinct offerings, each with real depth)
   — use for a Services or Products page where each item deserves more than
   one card's worth of content (features, pricing notes, a real CTA).
     interface PillarItem { id: string; label: string; summary: string; details: string[]; }
   Tabs (or an accordion on mobile) switch which item's full detail shows —
   this is what lets ONE page hold real depth per item instead of forcing
   either a wall of identical shallow cards or nine separate near-empty
   sub-pages.

3. TIMELINE/LEDGER (company history, a process, a sequence of steps/events)
   — use for About/Story pages or any "how it works" content.
     interface TimelineEntry { date: string; title: string; description: string; }
   Render as a vertical sequence with real chronological or step ordering
   visible in the layout itself (a connecting line, numbered markers) — not
   an unordered card grid, which throws away the sequence that's the whole
   point.

A page that is genuinely just a grid of same-shaped items (a simple product
catalog, a team photo grid) can still use a card grid — the rule is picking
the archetype that matches the CONTENT, not banning grids outright.

REAL SPECIFICITY IN COPY — pull every concrete fact already present in the
plan (appName, appDescription, features[].description, features[].userStories)
into the actual page copy verbatim or near-verbatim: the real company name,
the exact named services/products, any real numbers or claims the
description states. "We offer world-class solutions" when the spec says
"CRM, POS, bulk SMS, and domain hosting" is writing AROUND real information
you already have, not writing without it.
Full source-material specificity (real founder bios, real metrics, real
case studies from an uploaded company brochure) is not available yet — no
document upload path exists in this pipeline today (Workstream 5, not yet
built). Do not invent facts to fill that gap — an omitted section per R5c
is correct; a fabricated one is not. The rule above is narrower and fully
actionable now: never write GENERIC copy when SPECIFIC copy is already
sitting in the plan you were handed.
