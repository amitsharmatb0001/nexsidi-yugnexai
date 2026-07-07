# Task 15 Fix Review — Sonnet 5 Correction

Verdict: APPROVED

## Repo-wide grep verification

Ran `grep -rn "claude-opus-4-8" --include="*.ts" .` myself (also extended to `*.env*`/`*.sql`/`*.md` for the two non-`.ts` files the implementer's report calls out). Results, non-`node_modules`:

| File | Context | In scope for Task 15 escalation tier? |
|---|---|---|
| `agents/tilotma/src/index.ts:2` | Comment: "Uses claude-opus-4-8 (Anthropic SDK) as its brain." | **No** — Tilotma's own orchestrator, a separate agent. |
| `packages/db/src/migrations/0000_initial.sql:107` | Seed row `('tilotma', 'claude-opus-4-8', 'orchestrator', 1)` | **No** — same reason. |
| `pipeline/.env:1` | Comment header `# ─── Anthropic (Tilotma orchestrator — claude-opus-4-8) ───` | **No** — same reason. |

I independently confirmed these are genuinely unrelated to the `CLAUDE_ESCALATION_MODEL` constant — none of the three references it, import from `packages/llm-client`, or sit anywhere near the escalation-tier code path. The claim checks out.

**However**, tracing this further surfaced something worth flagging separately (not a defect in this fix, and correctly left out of scope, but the implementer's "Tilotma's own orchestrator model configuration" framing deserves a caveat): `agents/tilotma/src/orchestrator.ts` states "Zero Anthropic SDK dependency — 100% open-source models through NIM" and Tilotma's actual model comes from `FALLBACK_CHAIN["tilotma"]` (NIM, primary `deepseek-v4-pro`) — matching `CLAUDE.md`'s roster table (Tilotma = DeepSeek V4-Pro). So the "claude-opus-4-8" in `index.ts`'s comment, the DB seed row, and `pipeline/.env` don't describe any model Tilotma actually calls — they're stale/wrong regardless of which Claude string is "correct." This is a pre-existing inconsistency, correctly out of scope for a fix scoped to the escalation tier, and the implementer flagged it honestly in their Concerns section rather than silently leaving it. Worth a follow-up ticket, not a blocker here.

Vendor references in `node_modules/@anthropic-ai/sdk/**` (type-union literals, middleware doc comments) are obviously out of scope and correctly untouched.

## Model swap completeness

Confirmed via direct read of both files in full:

- `packages/llm-client/src/claude.ts` — `CLAUDE_ESCALATION_MODEL = "claude-sonnet-5"` (line 19); both `claudeChat` (line 103) and `claudeChatWithTools` (line 197) reference the constant, not a literal. Zero remaining `claude-opus-4-8` in the file.
- `packages/agent-runtime/src/claude-loop.ts` — both `console.log` lines (61, 210) now say `claude-sonnet-5`. These are log strings only; the actual API call in `runAgentWithClaude` goes through `claudeChatWithTools` → `CLAUDE_ESCALATION_MODEL`, so the log text and runtime behavior are consistent.
- `packages/llm-client/src/claude.test.ts` — the one literal-string assertion (`CLAUDE_ESCALATION_MODEL` toBe) updated to `"claude-sonnet-5"`.
- `packages/agent-runtime/src/claude-loop.test.ts` — confirmed via `git diff 21efc56~1 21efc56 -- <file>` this file has zero changes in this commit, and a grep for "opus"/"sonnet" in it returns nothing. It only tests orchestration logic via injected stubs, so there was nothing to change.
- Grepped every `*.test.ts` in the repo for `claude-opus-4-8` / `claude-sonnet-5` — only `claude.test.ts` matches either string.

Also verified the diff file (`task-15-fix.diff`) is byte-identical to `git diff 21efc56~1 21efc56` for the three touched source files — it's not stale or hand-edited.

## websearch.ts shared-constant claim

**Verified true.** Read `packages/agent-runtime/src/tools/websearch.ts` in full: line 2 imports `CLAUDE_ESCALATION_MODEL` from `@nexsidi/llm-client`, and line 39 passes it directly as `model: CLAUDE_ESCALATION_MODEL` in the `client.messages.create(...)` call — no hardcoded model string anywhere in the file. It picks up `claude-sonnet-5` automatically with zero edits required, exactly as claimed. Confirmed the barrel export chain resolves correctly (`packages/llm-client/src/index.ts` re-exports `CLAUDE_ESCALATION_MODEL` from `./claude.ts`).

## Thinking/sampling params unchanged

- `thinking: { type: "adaptive" as const }` is untouched in both `claudeChat` and `claudeChatWithTools` in `claude.ts`, and `websearch.ts` independently uses `thinking: { type: "adaptive" }`.
- Grepped `claude.ts`, `claude-loop.ts`, and `websearch.ts` for `temperature`, `top_p`, `top_k`, `effort` — the only hits are in comments explaining why they're absent; none are set as request params. Matches the pre-fix behavior exactly — this diff only touches the model-ID string and its surrounding prose.

## Test verification

Ran independently (not copy-pasted from the implementer's report):

```
$ bun test packages/llm-client/ packages/agent-runtime/
...
 18 pass
 0 fail
 53 expect() calls
Ran 18 tests across 5 files.
```

```
$ bun test
...
 107 pass
 0 fail
 212 expect() calls
Ran 107 tests across 20 files.
```

Both match the implementer's claimed counts exactly (18/18, 107/107). Console output during the test run confirms the escalation log line reads `escalating to Claude (claude-sonnet-5) as one-time retry`. Also ran `bun run --cwd packages/llm-client typecheck` (`tsc --noEmit`) — clean, no output, confirming the implementer's typecheck claim.

## Doc-comment accuracy

Read the full rewritten comment blocks in `claude.ts` (lines 15-18, 105-109) and the two log-line edits in `claude-loop.ts`. No leftover "most capable Opus-tier model" or other Opus-specific phrasing remains — the rewrite is a genuine rewrite, not a blind find-replace of "Opus 4.8" → "Sonnet 5" leaving surrounding text nonsensical. Two observations, both non-blocking:

1. **Honest hedging on sampling params.** The old comment asserted "removed/rejected on Opus 4.8" (a confirmed fact for that model). The new comment says "not documented as removed for Sonnet 5, but no reason to add" — this is an appropriately weaker claim given Sonnet 5 isn't in the reviewer's cached model documentation, rather than confidently asserting something unverified. Good practice.
2. **Minor tagline reuse, cosmetic only.** "Anthropic's best combination of speed and intelligence" is the same tagline associated with Sonnet 4.6 in cached model documentation, now applied to Sonnet 5 in a sentence that simultaneously argues *against* using Sonnet 4.6. This reads a little oddly on close inspection but is a marketing-copy nit, not a technical claim the code depends on — it doesn't affect behavior either way. Independently, I confirmed `claude-sonnet-5` is a real, current entry in the installed `@anthropic-ai/sdk@0.109.1` package's `Model` union type (`node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`), so the model string itself is not a hallucination — just newer than the reviewer's own cached documentation.

The "Extended thinking on Sonnet 5: adaptive only... it 400s on this model" comment is a specific technical claim I cannot independently verify (no Sonnet 5 docs available), but it's inert either way — `adaptive` thinking is the correct choice regardless of whether `budget_tokens` would also work, so there's no behavioral risk from an unverified claim here.

## Findings

None blocking. One follow-up worth a separate ticket (not part of this fix's scope): `agents/tilotma/src/index.ts`'s comment, the DB seed row, and `pipeline/.env`'s header all claim Tilotma runs on `claude-opus-4-8`, but `orchestrator.ts` shows Tilotma actually runs entirely on NIM (DeepSeek V4-Pro), matching `CLAUDE.md`'s roster. That stale Claude reference predates this fix and was correctly left untouched here, but it's misleading documentation independent of which Claude model string is "current."

## Recommendation

Approve as-is. The model swap is complete and consistent everywhere the escalation tier is actually invoked (`claude.ts`, `claude-loop.ts`, `claude.test.ts`, and transitively `websearch.ts` via the shared constant). Thinking/sampling parameters are unchanged. Tests and typecheck pass with the exact counts claimed. The three remaining `claude-opus-4-8` references are genuinely out of scope (a different agent's model config). Consider filing a follow-up to reconcile Tilotma's stale "claude-opus-4-8"/Anthropic-SDK documentation with its actual NIM/DeepSeek implementation, but that is unrelated to Task 15 and should not block this fix.
