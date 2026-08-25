LAYOUT PATTERNS:
  Use css() (see PANEL & SPINNER above) and gap for generic layout surfaces —
  never Tailwind grid classes, and never a Panel component (it does not exist
  in this library). Reserve Card for genuinely card-shaped content. Do NOT default to
  a generic nav+centered-hero+auto-fill-card-grid page structure. Derive the
  actual page structure (hero shape, section order, grid vs. list vs.
  dense-table layout, spacing rhythm) from the "Layout concept" line in the
  DESIGN IDENTITY section of your task below — that description is specific
  to THIS project and is what should drive your structural decisions, not a
  one-size-fits-all example.

STATIC FILES ALREADY WRITTEN (DO NOT rewrite unless you need to fix a bug):
- package.json (with @yugnex/core as a real npm dependency — components under
  components/nexui/ are your own project source, not an installed package)
- app/layout.tsx (StyleRegistry + ThemeProvider from @yugnex/core/client,
  plus NoFoucScript + createTheme from the main @yugnex/core entry — this
  project's colors are already wired in, do not replace with a different
  theme setup. It ALSO already imports and renders <Header /> and <Footer />
  from components/layout/ — see "FILES YOU MUST WRITE" below, you must
  create both or the build fails)
- app/globals.css (base reset using @yugnex/core's --nx-color-* variables —
  NO @apply Tailwind directives)
- app/theme-overrides.css (this project's font-family override — imported by
  globals.css, do not remove the import)
- middleware.ts (custom JWT cookie-based auth middleware for Next.js 16.2 —
  this IS the real, framework-recognized filename; do not rename it)
- next.config.ts
- tsconfig.json
- components/nexui/*.tsx (vendored NexUI component source — see NEXUI
  COMPONENT API below for what's actually available; edit these only to fix
  a genuine bug, never to add Tailwind/shadcn/ui-style classes)

FILES YOU MUST WRITE:
You MUST create all pages, routes, and components listed in the "PLANNED FRONTEND FILES AND PAGES" section of your task description. Typically this includes:
- app/page.tsx (landing / sign-in redirect)
- Dedicated routing files for each planned page (e.g., app/about/page.tsx, app/services/page.tsx, app/contact/page.tsx, app/dashboard/page.tsx)
- Do NOT consolidate separate public pages (about, services, contact) into dashboard tabs unless the plan explicitly requests it. Create separate dedicated file routes for them.
- components/layout/Header.tsx, exporting a named 'Header' component, and
  components/layout/Footer.tsx, exporting a named 'Footer' component —
  MANDATORY for any multi-page app, not optional polish. app/layout.tsx
  (the static scaffold — see above) already imports both from these EXACT
  paths and renders them around {children} on every route. This is
  deliberate, not something to work around: real bug found live (project
  a355bbb5fa35) — Header/Footer were built as components but never
  imported anywhere, so no page ever rendered site navigation. Because the
  scaffold now imports them unconditionally, skipping this step is no
  longer a silent content gap — it's a 'next build' failure ("Module not
  found"), caught by the VERIFICATION GATE below before task_complete can
  ever succeed. Header must link to every planned page (real hrefs, not
  placeholders); Footer carries the copyright line + YugNex watermark
  (rule 11 below) — never leave either as a stub.
- app/not-found.tsx, app/error.tsx, app/global-error.tsx, app/icon.svg —
  2026-08-24 (Workstream 4): confirmed live, page-by-page, against a real
  15-page production site — the generated app had ZERO of these; the
  reference site had all of them. MANDATORY for every project, not
  polish. These are Next.js App Router FILE CONVENTIONS (auto-discovered
  by exact filename — never imported anywhere), so a missing one does NOT
  fail `next build` the way a missing Header/Footer does; your own
  VERIFICATION GATE below runs a separate `cat` check per file instead —
  the SAME mechanical block, just enforced differently for a convention
  file vs. an imported one.
  - app/not-found.tsx: the custom 404 page shown for any unmatched route.
    Ordinary Server Component — no "use client" needed. Use the real
    palette/typography (design tokens), not a bare "404" on a blank page —
    a link back to / at minimum.
  - app/error.tsx: the error boundary for this route segment. MUST start
    with "use client" (Next.js requires it — a Server Component here fails
    silently at runtime, not at build time, so this is easy to get wrong
    without the build catching it). Receives `error: Error & { digest?:
    string }` and `reset: () => void` as props; render a real message plus
    a "Try again" button wired to reset().
  - app/global-error.tsx: the ROOT error boundary — replaces app/layout.tsx
    entirely when an error escapes the root layout itself, so unlike
    error.tsx it MUST render its own <html> and <body> tags (there is no
    outer layout wrapping it at that point). Also requires "use client".
    Skipping this file means a root-layout-level crash shows Next's bare
    unstyled default screen instead of anything on-brand.
  - app/icon.svg: a real favicon, not a missing one. Next.js App Router
    auto-serves app/icon.svg as the site's favicon with zero config. Write
    a simple, on-brand mark (a monogram, a shape) using the actual accent/
    ink colors from the design brief — never a generic placeholder square.

