# Task 6 Review

Verdict: NEEDS_FIXES

## Spec compliance

- `execWebSearch(args: { query: string }): Promise<ToolResult>` — matches exactly.
- `WEB_SEARCH_TOOL_DEF` — matches the `HTTP_TOOL_DEF` shape in `packages/agent-runtime/src/tools/http.ts` (`type: "function"`, `function.name/description/parameters`, `parameters.required`). Confirmed by direct comparison of `http.ts` and `websearch.ts`.
- Test file content is byte-for-byte the two tests specified in the plan's Step 1. Both pass.
- `ToolResult` is imported from `./file.ts`, matching the plan's stated "Consumes" interface, and the fields used (`status`, `summary`, `output`, `next_actions`) match the real interface at `packages/agent-runtime/src/tools/file.ts:5-10`.
- `packages/agent-runtime/src/index.ts` diff is a single additive export line — nothing else touched.

**Discrepancy worth flagging:** the review brief states "the plan explicitly says do NOT modify `loop.ts` in this task." That is not what the plan document actually says. `docs/nexsidi/plans/2026-07-02-full-agentic-pipeline.md:527` (Task 6, Step 5) explicitly instructs: *"extend `AgentRunConfig` in `loop.ts` with `enableWebSearch?: boolean`, wiring it the same way `enableHttpTools` is wired ... Commit as part of this task."* The implementer's own report (`.nexsidi/sdd/reports/task-6-implementer.md:43`) acknowledges skipping this: *"Ready for the next integration task (wiring into loop.ts) when that task runs."* I searched the rest of the plan (grep for `enableWebSearch`/`web_search`) and **no later task (7-13) wires `web_search` into `loop.ts`** — Task 7 modifies `loop.ts` but only for the `screenshot` tool. As things stand, `web_search` is fully implemented and exported but not reachable from `runAgent()`/`AgentRunConfig` — no agent can actually call it yet, and there's no tracked follow-up task in this plan to do so. This should be logged explicitly (e.g. in `PROGRESS.md` or a new task) rather than left implicit, since the plan's own Task 6 spec treats it as in-scope.

## Test verification

Ran it myself:
```
$ bun test packages/agent-runtime/src/tools/websearch.test.ts
bun test v1.3.14 (0d9b296a)

 2 pass
 0 fail
 4 expect() calls
Ran 2 tests across 1 file. [76.00ms]
```
Confirmed passing right now, matches the implementer's reported output. (Note: I can only verify the tests pass now, not that they were genuinely written and observed red before the implementation — that ordering claim rests on the implementer's self-report, which is plausible and matches the plan's prescribed content, but the squashed diff/commit alone doesn't prove it.)

## Findings

🟡 **Missing timeout on the search API call — inconsistent with `http.ts`'s established pattern.** `websearch.ts`'s `fetch(apiUrl, ...)` call has no `AbortController`/timeout at all:
```ts
const res = await fetch(apiUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ query: args.query }),
});
```
Compare to `http.ts`, which wraps every request in an `AbortController` + `setTimeout` (default 10s, capped at 30s) specifically so a hung endpoint can't stall the caller. `loop.ts`'s `runAgent()` has no outer timeout around tool execution either (`await execHttpRequest(...)` / `await execWebSearch(...)` block the iteration loop directly), so a slow or hanging `WEB_SEARCH_API_URL` would hang the entire agent iteration indefinitely once this tool is wired into `loop.ts`. This is the one place the task explicitly asked me to check ("Is the timeout/error handling consistent with `http.ts`'s pattern?") and the answer is no — it's a real gap, not a style nit. Fix: add the same `AbortController`/`timeout_ms` pattern used in `http.ts` before this tool is wired into the live loop.

💡 Minor, non-blocking: `http.ts` truncates response bodies to 2000 chars, `websearch.ts` truncates to 3000. Not a bug (different endpoints, arbitrary but reasonable), just noting the inconsistency in case it wasn't intentional.

💡 `websearch.ts` uses `res.ok` (200-299) to decide success, while `http.ts` uses a looser `status >= 200 && status < 500`. This is actually more correct behavior for a search API (no need to treat 4xx from a third-party search endpoint as "success"), so not flagging as a bug — just noting it's a deliberate-looking deviation from the "same pattern" language in the task description, worth a one-line comment in the code so a future reader doesn't assume it's an oversight.

**Security check (explicitly asked):** the "not configured" fallback (`apiUrl`/`apiKey` missing) does not leak secret values — it only names the env vars (`WEB_SEARCH_API_URL/KEY`) that are unset, which is safe, non-sensitive diagnostic text. No issue there.

**Scope check (explicitly asked):** `loop.ts` was NOT modified — confirmed via `git show 01019e4 -- packages/agent-runtime/src/loop.ts` (empty) and via `git log --all -- packages/agent-runtime/src/loop.ts` (last touched in an earlier recovery commit, `1460f5b`, well before this task). The diff review package is accurately scoped to commit `01019e4` (3 files, 56 insertions, matches `git show 01019e4 --stat` exactly).

**Additivity check (explicitly asked):** `index.ts` diff is a single new export line appended after the existing `DOCKER_TOOL_DEF` export; no existing line was touched or reordered. Purely additive.

## Recommendation

Do not merge as final until:
1. Add the same `AbortController`/timeout guard `http.ts` uses to `execWebSearch`'s `fetch` call (🟡 above) — cheap fix, same pattern already in the codebase to copy.
2. Explicitly track the `loop.ts`/`AgentRunConfig.enableWebSearch` wiring as a real task (either fold it back into this task per the plan's own Step 5, or add it as a named task before Task 11/Stage 4, since Stage 1/Stage 4 depend on Saanvi/Shubham/Aanya actually being able to call `web_search` per the plan's Goal statement and the file map's stated purpose "New `web_search` tool for Saanvi (Stage 1) and Shubham/Aanya (Stage 4 package verification)"). Right now the tool exists but nothing can invoke it.

Everything else (signature, tool-def shape, test content/pass, additive export, no leakage, loop.ts untouched-as-instructed) checks out cleanly.
