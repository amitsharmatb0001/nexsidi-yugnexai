# Aanya NexUI Vendoring Migration — @yugnex/nexui-react → @yugnex/core + CLI

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace Aanya's whole-package NexUI vendoring
(`@yugnex/nexui` + `@yugnex/nexui-react`, copied wholesale from a local
`nexui-publish/` directory) with the new shadcn/ui-style model
(`@yugnex/core` as a real dependency + individual components copied in
via `@yugnex/cli`, now live at `https://new.yugnex.com`), without
breaking generation for a single project in the process.

**Architecture:** Five sequenced changes, in dependency order — later
tasks depend on earlier ones landing first, this is NOT parallelizable
the way the cost-control plan's Tasks 1-3 were:
1. Component API audit (this doc — already done, see below)
2. Vendoring swap (`vendorNexui` → CLI calls against the registry)
3. Scaffold rewrite (`package.json`, `next.config.ts`, `globals.css`, `layout.tsx`)
4. System prompt rewrite (the ~150-line NEXUI COMPONENT API reference)
5. End-to-end verification against a real generation run

**Tech Stack:** No new dependencies in NexSidi's own repo — the CLI
(`@yugnex/cli@0.1.1`) and runtime (`@yugnex/core@0.1.0`) are already
published and confirmed working live.

## Global Constraints

- Every one of the 15 components Aanya currently references must have
  an explicit resolution in the new system before the prompt ships —
  no silent gaps. Two are confirmed real gaps (Panel, Spinner) with
  resolutions below; if implementation finds MORE gaps, stop and
  surface them rather than guessing a workaround.
- The registry URL (`https://new.yugnex.com`) must be configurable via
  an environment variable, not hardcoded — this is currently a
  private, internal-testing-only host on the team's own infrastructure,
  not a public CDN. A future move to a different host/domain must not
  require another code change.
- Must not repeat the exact failure class already found and fixed once
  this session (the proxy.ts/middleware.ts scaffold bug where a
  confidently-wrong rule shipped in both the deterministic scaffold AND
  the prompt with zero test ever checking it) — every claim this plan
  makes about the new component API must be verified against the real
  registry JSON, not assumed from the README.
- No project should generate with a half-migrated state (e.g. new
  provider imports but old CSS variable names, or new components but
  old prop shapes) — the swap ships as one coherent change, tested
  end-to-end, not merged in pieces that individually look done but
  don't compose.

---

## Component API audit (completed as part of writing this plan)

Verified directly against `E:\nex-ui\apps\docs\public\r\*.json` — not
inferred from the README or old prompt.

**13 direct matches** (component exists under the same name; props
confirmed different in at least the one checked in depth — see below):
Button, Card, Input, Badge, Checkbox, Modal, Tabs, Select, Tooltip,
Switch, Progress, Skeleton, Avatar, Separator.

**Confirmed prop-shape change (Button, checked in full):**
```
OLD: <Button variant="primary" size="md">   variant: "primary" | "ghost" | ...
NEW: <Button variant="solid" tone="primary" size="md">
     variant: "solid" | "outline" | "ghost" | "soft"
     tone: "primary" | "destructive"
     size: "sm" | "md" | "lg"
     isLoading?: boolean
     asChild?: boolean
```
The other 12 direct-match components have NOT yet been individually
checked prop-by-prop — Task 4 below must check every one against its
real registry JSON before writing prompt text for it, using the same
`cat .../button.json` extraction method used here. Do not assume any
of them are prop-compatible with the old ones just because the name
matches.

**2 confirmed gaps — no equivalent component exists:**

- **Panel** (used as the generic layout/surface container throughout
  the old prompt's "LAYOUT PATTERNS" section — `<Panel variant="surface"
  padding="md">`, `<Panel variant="elevated" padding="lg">`). `Card` is
  NOT a substitute — checked in full: it's a fixed-shape semantic
  component (Card/CardHeader/CardTitle/CardDescription/CardBody/CardFooter)
  with baked-in padding/border/shadow, meant for actual card content,
  not a generic wrap-anything container. **Resolution:** teach Aanya to
  use `css({...})` directly from `@yugnex/core` for generic surfaces
  (padding/radius/background via `theme.space[n]`/`theme.radius.*`/
  `theme.color.card`), and reserve `Card`/`CardBody` for genuinely
  card-shaped content blocks. This is the idiomatic way the new system
  wants ad hoc containers built — `css()` exists specifically for this.
- **Spinner** (used for loading states — "use Spinner while fetching").
  No standalone component exists in the registry. Found the actual
  pattern instead: `button.tsx`'s own source builds a spinner inline via
  `keyframes()` + `css()` (a `spin` keyframe animating `rotate(0deg)` →
  `rotate(360deg)`, rendered as a bordered circle with a transparent top
  edge). **Resolution:** for button-scoped loading, use Button's own
  `isLoading` prop (already handles this internally — no extra spinner
  needed). For non-button loading states (page/section loading), either
  use `Skeleton` (content-shaped placeholder, closer to what modern
  design systems actually recommend over a bare spinner) or teach Aanya
  the same inline `keyframes()`/`css()` spinner pattern `button.tsx`
  itself uses, as a fallback for the rare case neither fits.

**Not yet audited — required before Task 4 ships:** CSS/theme variable
naming. Old prompt taught raw `var(--nx-bg-base)`, `var(--nx-accent)`,
etc. for inline style overrides. New system exposes tokens via the
`themeVars`/`theme` JS object (`theme.color.card`, `theme.space[6]`,
`theme.radius.lg`) inside `css()`, not necessarily as directly-usable
CSS custom properties with the same names. Task 2 (vendoring/scaffold
swap) must resolve this — check whether `@yugnex/core`'s runtime
actually emits `--nx-*`-shaped CSS variables at all, or whether every
old `var(--nx-*)` reference in generated code (including the DESIGN
IDENTITY section's `theme-overrides.css` cascade trick) needs to become
a `css({ color: theme.color.foreground })`-style call instead. This is
a real unresolved question, not a settled fact — do not assume either
answer without checking `@yugnex/core`'s actual runtime output.

---

## Task 1: Swap `vendorNexui()` for CLI-based per-component vendoring

**Files:**
- Modify: `agents/generators/aanya/src/index.ts` (`vendorNexui`,
  `stripDevDependencies`/`stripVendoredPackageJsonDevDeps` likely
  become unused or need rescoping — the new model has no vendored
  `package.json` to strip devDependencies from, since components are
  raw `.tsx` files, not a package)
- Test: `agents/generators/aanya/src/index.test.ts`

**Interfaces:**
- Produces: a rewritten `vendorNexui(outputDir, components: string[])`
  (or equivalent) that shells out to `@yugnex/cli`'s `init`/`add`
  commands against a configurable registry URL, instead of `cpSync`-ing
  whole package trees
- Consumes: `NEXUI_REGISTRY_URL` env var (new — mirrors the existing
  `NEXUI_DIR` pattern used by the old vendoring), defaulting to
  `https://new.yugnex.com` for now

Given every generated project doesn't necessarily use every one of the
15 (now 13 direct + Panel/Spinner resolutions) components, this task
should pull in only the components a given project's task plan
actually references, not all of them unconditionally — this is a real
opportunity to cut generated bundle size and vendoring time versus the
old "copy everything" approach, but ONLY do this if it can be done
without risk of missing a needed component (e.g. parse the planned
file manifest for component usage, or default to a safe fixed list of
all confirmed-mapped components if usage can't be reliably determined
from the plan alone — do not guess, pick the safer option if uncertain).

- [ ] **Step 1: Write the failing test** — assert `vendorNexui` (or its
  replacement) shells out to the CLI with the correct registry URL and
  produces the expected `components/nexui/*.tsx` files in `outputDir`,
  using a test double / local fixture registry (mirroring how the
  existing tests avoid live network calls — check `index.test.ts`'s
  existing patterns before inventing a new one).
- [ ] **Step 2: Run test, verify it FAILS** against the old `cpSync`-based implementation.
- [ ] **Step 3: Implement.** Decide and document: does this call the
  CLI as a subprocess (`run_command`-shaped, matching how Aanya's own
  agent loop already shells out to `npm`/`next`), or does it use
  `packages/cli`'s exported functions directly as a library import
  (avoiding a subprocess spawn)? Check `packages/cli/src/index.ts`'s
  actual exports before deciding — prefer the library-import path if
  the CLI's internals are cleanly importable, since it avoids
  subprocess overhead and flakiness in a generator that already runs
  dozens of iterations per project.
- [ ] **Step 4: Run test, verify it PASSES.**
- [ ] **Step 5: Commit.**

---

## Task 2: Rewrite the scaffold (`package.json`, `next.config.ts`, `globals.css`, `layout.tsx`)

**Files:**
- Modify: `agents/generators/aanya/src/index.ts`
  (`writeStaticScaffold`, `buildScaffoldNextConfig`,
  `buildScaffoldTsconfig` if the `vendor` exclude is no longer needed)
- Test: `agents/generators/aanya/src/index.test.ts`

Changes required, each verified against real `@yugnex/core` behavior,
not assumed:
- `package.json`: replace `"@yugnex/nexui": "file:./vendor/nexui"` +
  `"@yugnex/nexui-react": "file:./vendor/nexui-react"` with
  `"@yugnex/core": "^0.1.0"` as a real (non-`file:`) dependency.
- `next.config.ts`: `transpilePackages: ["@yugnex/nexui-react",
  "@yugnex/nexui"]` — almost certainly no longer needed at all, since
  `@yugnex/core` ships pre-built `dist/*.js` (confirmed in the earlier
  npm tarball inspection) rather than raw TypeScript source needing
  transpilation. Verify this assumption against a real `next build`
  before removing it, don't just assume.
- `globals.css`: replace `@import "@yugnex/nexui/css/nexui-tokens.css"`
  / `@import "@yugnex/nexui/css/nexui-base.css"` — resolve per the
  unaudited CSS-variable question above. If `@yugnex/core` doesn't ship
  equivalent global CSS imports, this whole file's structure may need
  to change (e.g. token injection happens via `ThemeProvider` at
  runtime instead of a static CSS import) — check `@yugnex/core/client`'s
  actual `ThemeProvider`/`StyleRegistry` implementation before assuming
  the old import-based pattern has any equivalent at all.
- `layout.tsx`: replace `NexuiProvider` (from `@yugnex/nexui-react`,
  taking `theme="void" customTokens={...}`) with `StyleRegistry` +
  `ThemeProvider` + `NoFoucScript` (from `@yugnex/core/client`, per the
  README's own usage example). The old per-project `customTokens`
  override mechanism (`buildThemeOverrideTokens(plan.designBrief)`,
  the fix for the cascade-order bug documented at this file's own
  `2026-08-06` comment) needs a real equivalent in the new system —
  check `createTheme()`'s actual signature (seen in `@yugnex/core`'s
  type defs: `createTheme`, `ThemeOverrides`, `ThemeVars`) to find how
  per-project token overrides are meant to be supplied now, and confirm
  the SAME cascade-order bug class can't recur (verify empirically,
  don't just trust the API looks different enough to be safe).
- `buildScaffoldTsconfig`'s `exclude: ["node_modules", "vendor"]` — the
  `"vendor"` exclusion existed specifically because whole-package
  vendored source wasn't held to the generated project's own
  TypeScript strictness. If Task 1 moves to per-component `.tsx` files
  copied into `components/nexui/` (real, first-party source the
  project SHOULD typecheck), this exclusion may need to change or be
  removed — decide based on what Task 1 actually produces.

- [ ] **Step 1: Write the failing test(s)** for the new scaffold output shape.
- [ ] **Step 2: Run tests, verify they FAIL** against the old scaffold.
- [ ] **Step 3: Implement**, verifying each of the 5 sub-changes above
  against real `@yugnex/core` behavior (read its actual source/dist,
  don't assume from the README alone — the README is marketing copy,
  the dist/type-defs are ground truth).
- [ ] **Step 4: Run tests, verify they PASS.**
- [ ] **Step 5: Real build check** — with Task 1 also in place, actually
  run `npm install && npx next build` against a generated scaffold (not
  just unit tests) to confirm the whole chain compiles for real. Unit
  tests alone are not sufficient sign-off for this task given how much
  of it depends on runtime behavior (cascade order, CSS injection
  timing) rather than pure logic.
- [ ] **Step 6: Commit.**

---

## Task 3: Rewrite the system prompt's NEXUI COMPONENT API reference

**Files:**
- Modify: `agents/generators/aanya/src/index.ts`
  (`AANYA_SHARED_PROMPT_BASE`'s "NEXUI COMPONENT API — COMPLETE
  REFERENCE" section, and the "STACK"/"NEXUI CSS VARIABLES"/"LAYOUT
  PATTERNS" sections around it)
- Test: `agents/generators/aanya/src/index.test.ts` (prompt-content
  assertions, matching the existing pattern already used for the
  proxy.ts/middleware.ts prompt-rule regression test from earlier this
  session)

This is the highest-volume-of-change task — every one of the ~150
prompt lines describing component usage needs to be checked against
real registry JSON (per the audit method demonstrated above for
Button/Card) and rewritten to match. Do NOT write plausible-sounding
prop examples from memory or by pattern-matching the old prompt's
style — every single prop name, type, and default shown in the new
prompt must be copied from the real `.tsx` source in
`E:\nex-ui\apps\docs\public\r\*.json`, the same way this plan's Button
and Card examples were extracted.

- [ ] **Step 1: For each of the 13 direct-match components**, extract
  the real component source from its registry JSON and write the
  correct prop reference (mirroring this plan's Button example format).
- [ ] **Step 2: Write the Panel and Spinner resolution guidance**
  (the `css()`-based generic container pattern, and the
  Skeleton/inline-keyframes loading pattern) as concrete prompt text
  with a real code example, not just a description.
- [ ] **Step 3: Resolve and rewrite the "NEXUI CSS VARIABLES" section**
  once Task 2's CSS-variable audit answers whether `--nx-*` custom
  properties still exist in any form.
- [ ] **Step 4: Write a regression test per component** asserting the
  prompt text contains the CORRECT current prop shape and does NOT
  contain the old, now-wrong prop values (e.g. assert
  `variant="primary"` does NOT appear as a Button example anywhere in
  the new prompt) — mirroring the exact test-writing pattern already
  used this session for the proxy.ts-forbidden / middleware.ts-required
  prompt assertions.
- [ ] **Step 5: Run tests, verify they PASS.**
- [ ] **Step 6: Commit.**

---

## Task 4: End-to-end verification against a real generation run

**Not a code task — a verification gate.** Per this plan's global
constraint against shipping a half-migrated state:

- [ ] Run Aanya's `run()` against a real (or realistic fixture) `BuildPlan`
  with Tasks 1-3 merged, actually generating a small multi-page project.
- [ ] Confirm `npm install`, `npx tsc --noEmit`, and `npx next build`
  all pass on the generated output — not mocked, not assumed.
- [ ] Confirm at least one page actually renders correctly in a browser
  check (screenshot or `browser_get_text`), matching the same
  verification discipline Aanya's own prompt already requires of
  itself, applied here to confirm the SCAFFOLD (not Aanya's own
  generated pages) is sound before this ships to every future project.
- [ ] Confirm the watermark/footer, auth flow, and middleware.ts
  behavior (all previously-fixed real bugs this session touched) are
  unaffected by this change — a regression sweep, not just a new-feature check.

## What this does NOT cover (explicitly out of scope)

- Migrating already-generated projects (freshtst1, rivhdw1, etc.) to
  the new component model — those stay on the old vendored packages
  they were built with. This plan only changes what NEW projects get
  from this point forward.
- Making the `nex-ui` GitHub repo public, or moving off the private
  `new.yugnex.com` host to a permanent public CDN — separate decision,
  not blocking this migration.
- Auditing all 51 available components for potential future use beyond
  the 13+2 currently referenced — only the components Aanya's prompt
  already uses (plus their resolutions) are in scope here.

## Definition of done

All 4 tasks complete, full test suite passing, one real end-to-end
generation run (Task 4) verified with actual `next build` + browser
check, and the prompt contains zero references to the old `@yugnex/nexui-react`
package or any now-incorrect prop shape (e.g. `variant="primary"` on Button).
