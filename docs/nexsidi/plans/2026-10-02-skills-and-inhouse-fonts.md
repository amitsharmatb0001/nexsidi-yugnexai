# Skill Library and In-House Fonts — Implementation Plan

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Generated apps use only NexUI's own fonts, and every agent gets
task-specific skills loaded on demand, like Claude Code's skills.

**Architecture:** (1) The design brief may only name in-house fonts; the
frontend scaffold copies those font files into the app and writes their
`@font-face` CSS — no Google Fonts. (2) A skill library
(`packages/agent-runtime/skills/library/<name>/SKILL.md`) with three levels:
an index of every skill in each agent's prompt, full skills auto-loaded when
the task matches, and a `load_skill` tool for anything else.

**Tech Stack:** Bun 1.3, TypeScript, existing prompt assembly and agent loops.

## Global Constraints

- Approved by Amit on 2 Oct 2026: in-house fonts only, never Google Fonts.
- No change to the patent loops (adversarial QA, full retest, thresholds).
- Tests first; full suite + typecheck before each commit; one commit per task.
- Commit notes: plain title, Added / Changed / Removed, Why.
- Skills are general knowledge, never answers to a specific benchmark check.
  The exact skill set is recorded in the benchmark pre-registration.

## Facts this plan is based on

- NexUI fonts live in `nexui-publish/nexui/fonts` (tracked in the repo):
  Inter (400, 500, 600, 700, 800), JetBrains Mono (400, 500), NexuiSans
  (400, 500, 700), NexuiMono (400), NexuiIcons.
- None of them contain the rupee sign (basic Latin subsets: Inter and
  JetBrains Mono about 230 characters, NexuiSans and NexuiMono 95). Every
  font stack therefore ends in system fonts, which draw the rupee sign.
  Adding the rupee sign to the in-house fonts is a later design-system task.
- Today `@yugnex/core` (installed into generated apps) ships no fonts, and
  the scaffold links Google Fonts (`googleFontStylesheets`), which let a
  brief pick Cabinet Grotesk — not on Google — so headings fell back to
  Times New Roman.
- Today every agent gets one fixed set of doctrine files whatever it builds
  (`prompt-assembly.ts`); there is no library and no on-demand loading
  (decision D37's three levels were never built).

## File Map

| File | Change | Responsibility |
|---|---|---|
| `agents/generators/aanya/src/fonts.ts` | Create | In-house font catalogue; map any requested font to an in-house one; copy files and write `@font-face` CSS |
| `agents/generators/aanya/src/fonts.test.ts` | Create | Tests |
| `agents/generators/aanya/src/index.ts` | Modify | Scaffold uses `fonts.ts`; no Google links |
| `agents/generators/aanya/src/theme.ts` | Modify | Remove `googleFontStylesheets`; font stacks use in-house families + system fallback |
| `agents/vanya/src/index.ts` | Modify | Brief typography limited to in-house fonts; coerces anything else |
| `packages/agent-runtime/src/skill-library.ts` | Create | Parse skills, build the index, select skills for a task, load a skill |
| `packages/agent-runtime/src/skill-library.test.ts` | Create | Tests |
| `packages/agent-runtime/src/prompt-assembly.ts` | Modify | Append index + auto-selected skills |
| `packages/agent-runtime/src/loop.ts`, `gemini-loop.ts`, `claude-loop.ts`, `qa-loop.ts` | Modify | Pass the task text for selection; `load_skill` tool |
| `packages/agent-runtime/skills/library/*/SKILL.md` | Create | The first skills |

---

### Task 1: In-house fonts only

- [ ] Failing tests: a brief asking for "Cabinet Grotesk" resolves to an
  in-house display font; the scaffold copies only the used font files into
  `public/fonts/` and writes `@font-face` rules pointing at them; the layout
  contains no `fonts.googleapis.com`; every font stack ends in system fonts;
  Vanya's prompt lists only in-house fonts.
- [ ] Implement `fonts.ts`; wire the scaffold; remove `googleFontStylesheets`.
- [ ] Full suite + typecheck; commit.

### Task 2: Skill library core (three levels)

- [ ] Failing tests: frontmatter parsed (`name`, `description`, `agents`,
  `keywords`); the index for an agent lists only skills for that agent;
  selection for a GST invoicing task picks the GST skill, for a dashboard
  task the dashboard skill; selected skills stay within a size budget;
  `load_skill` returns a skill's text and a clear error for an unknown name.
- [ ] Implement `skill-library.ts`; prompt assembly appends the index and
  the selected skills; loops pass the task text and offer `load_skill`.
- [ ] Full suite + typecheck; commit.

### Task 3: First skills

Written from what real builds got wrong, each with a "use when" line:
frontend (landing composition, dashboards, tables with search and filters,
forms, auth flows, empty/loading/error states, mobile, typography with
in-house fonts, charts), backend (Express API structure, JWT and per-user
data isolation, money in exact paise, input validation, per-account
numbering, safe migrations), domain (Indian GST invoicing, Indian number and
date formats), review (money logic, security).

- [ ] A test asserts every skill parses and names real agents.
- [ ] Full suite + typecheck; commit.

### Task 4 (after the benchmark): learning loop

Each failed check's root-cause class produces a drafted skill update for
Amit's approval. Not built in this plan.

## Self-review

- Coverage: fonts (Task 1), library and loading (Task 2), content (Task 3),
  learning loop deferred by agreement (Task 4).
- Names used consistently: `fonts.ts`, `skill-library.ts`, `load_skill`.
