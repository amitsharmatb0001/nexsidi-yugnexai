# Task A1 Report — Wire NexUI Provider, Remove Tailwind

**status: DONE_WITH_CONCERNS**

## What was changed

### apps/web/app/layout.tsx
Replaced the bare layout with full NexUI provider tree:
- `import "./globals.css"` — kept first (provides NexuiIcons @font-face + body resets)
- `import "@yugnex/nexui/nexui-utils.css"` — utility classes
- `NexuiProvider theme="void"` wraps the app
- `ToastProvider` + `Toaster` nested inside
- `suppressHydrationWarning` on `<html>`
- Used subpath imports (`/provider`, `/toast`) — confirmed present in nexui-react package.json exports

### apps/web/package.json
Removed from `devDependencies`: `tailwindcss`, `autoprefixer`, `postcss`

### apps/web/tailwind.config.ts, apps/web/postcss.config.js
Both deleted.

### apps/web/app/globals.css
Not changed. Contains real custom styles: NexuiIcons @font-face (loading from `/nexui-fonts/NexuiIcons.woff2` in the public folder), body resets, app-specific keyframes, and CSS utility classes. Still imported first in layout.tsx.

Note: The `--nx-*` token vars defined in globals.css will be overridden at runtime by `initializeNexuiEngine()` called from `NexuiProvider`. That is fine — they serve as SSR fallback values.

### packages/nexui-react/package.json
Bumped `@types/react` and `@types/react-dom` from `^18.0.0` → `^19.0.0`. This was required because the old types caused a TypeScript error in layout.tsx: `ReactNode` from `@types/react@18` does not include `bigint`, while React 19 adds it, making the `children` prop incompatible.

## Typecheck result

```
Exit: 0  (clean — no errors)
```

The nexui and nexui-react packages were built locally (`tsc --noEmitOnError false`) to generate dist files needed for type resolution. The `dist/` folders are git-ignored.

## Concerns

1. **nexui-react/dist/ is git-ignored and not committed** — Any fresh checkout requires building the workspace packages before `apps/web` can typecheck. Build order: `packages/nexui` → `packages/nexui-react` (with `--noEmitOnError false`). A workspace-level `build:packages` script would address this.

2. **nexui-react pre-existing build errors (15+ in primitives.tsx)** — Custom Web Component element names (`nex-panel`, `nex-button`, etc.) are not declared in `JSX.IntrinsicElements`, causing type errors in `primitives.tsx`. Also `tooltip.tsx` has 2 errors. These are pre-existing and unrelated to Task A1, but they require `--noEmitOnError false` to produce the dist. Task A1 scope does not cover fixing these.

3. **globals.css import order** — `globals.css` is imported before `nexui-utils.css` so that NexUI utilities take precedence over any conflicting globals.css utilities. If there are ordering issues, reversing is a one-line change.

## Commits

- `87df7e5` — feat(web): wire NexUI provider, remove Tailwind (main task changes: layout, package.json, deleted configs, nexui-react @types/react bump, lockfile)
- The globals.css import line (1-line addition) was accidentally included in the pre-existing `f83c0af` commit during a git amend. The end state of all files is correct; only the commit attribution is imperfect.
