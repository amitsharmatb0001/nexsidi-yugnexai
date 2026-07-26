## Task A4 — CLAUDE.md NexUI Migration Update

**Status:** DONE  
**Commit:** 4f6aabe

Two targeted edits were applied to `CLAUDE.md`:

1. In the "NexSidi's Own Platform" tech stack section (line 180), the Frontend line was updated from `Next.js 16.2 + TypeScript + Tailwind + shadcn/ui` to `Next.js 16.2 + TypeScript + @yugnex/nexui + @yugnex/nexui-react`, reflecting the migration to the proprietary NexUI design system.

2. In the "WHAT CLAUDE CODE MUST DO" section, a new prohibition line was inserted immediately after the Next.js version guard: `⛔ NEVER use Tailwind or shadcn/ui in NexSidi's own platform (apps/web) — use @yugnex/nexui-react`, ensuring all future sessions enforce the NexUI constraint at the platform level.

No other lines were touched. The commit was made directly on branch `feat/nexsidi-pipeline-v2-eager`.
