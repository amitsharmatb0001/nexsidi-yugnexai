# Triage Compaction Implementation Plan

> **For agentic workers:** Use nexsidi-subagent-dev (preferred) or
> nexsidi-planning execute mode to implement task-by-task.
> Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Stop compaction from throwing away evidence agents still need (unresolved errors, the latest result per file/URL/command), while still cutting repeated and superseded tool output, and fix two real bugs in the NIM/Claude compaction path.

**Architecture:** A deterministic, $0, no-LLM "triage" pass over the middle of a Gemini history that `selectRelevantContext` currently discards wholesale. Each old tool call is kept, truncated (head + tail), or stubbed (result replaced by a one-line note), using NexSidi's own tool semantics. Messages are never removed and call/response pairs are never split. It ships behind `TRIAGE_COMPACTION_ENABLED` (default off), is proven on all real saved histories by a replay harness first, then A/B-tested on a live build before the default changes.

**Tech Stack:** TypeScript, Bun (`bun test`), existing `@nexsidi/llm-client` message types (`GeminiMessage`, `NimMessage`, `ClaudeMessage`), `postgres` (read-only, harness only).

## Evidence this plan is based on (measured 2026-09-26)

| Fact | Source |
|---|---|
| 124 saved agent conversations in the DB: **119 Gemini-shaped** (avg ~88K tokens, max ~580K), **0 NIM, 0 Claude** | `agent_conversations` table, dev Postgres |
| Gemini loop compacts at 120K tokens by keeping system + task + fact ledger + last 6 turns; **the whole middle is dropped and the result is persisted** | `context-selection.ts` `selectRelevantContext`, `gemini-loop.ts:612-614`, `:426-428` |
| QA agents compact ~30 times per build with **"fact ledger: 0 entries"**: the ledger only records write/edit/delete/run_command/escalate/task_complete, never `http_request`, `browser_*`, `screenshot`, `read_file`, `docker_compose` | `pipeline.log` of builds 05b590e98102 (32 events) and 6ec9787d5a81 (28 events); `inferEntriesForActivity` |
| In the dropped middles of real histories, `read_file` = 37% and `docker_compose` = 35% of tool output; **35% of it is exact repeats** (same tool + same args, a newer copy exists) | on-disk `history-*.json` over 400 KB (≈3 unique histories: small sample, Task 3 re-measures on all 119) |
| **Claude loop compaction never fires**: `estimateTokenCount` reads `content.length` on block arrays, so a ~50,000-token Claude history is estimated as **2 tokens** | probe run against `compaction.ts` on this branch |
| NIM/Claude `compactHistory` keeps "last 4 messages" with no pairing check, so it can start on a tool result whose call was summarized away (API rejects) | `compaction.ts:36-37` |

## Global Constraints

- Branch: `feat/nexsidi-pipeline-v2-eager`. This worktree is on `claude/eager-varahamihira-967edb`, which is 172 commits behind it with 0 unique commits. Before Task 1: `git checkout feat/nexsidi-pipeline-v2-eager` (needs Amit's OK).
- Tests first for every task (`bun test <file>`), then `bun run typecheck` in `packages/agent-runtime`.
- Never remove a message from history. Never split a call from its result (Gemini functionCall/functionResponse, NIM tool_calls/tool, Claude tool_use/tool_result).
- Never modify Gemini `thought` parts or any `thoughtSignature`; never modify Claude `thinking`/`redacted_thinking` blocks; never modify assistant/model turns' functionCall args in the triage pass (results only).
  - **Amended 2026-09-27 (Amit approved option A):** the file content inside `write_file`/`write_files`/`edit_file` args MAY be replaced by a one-line note when that file is fully rewritten or deleted later. The latest content of every file stays verbatim, and the functionCall's other fields (including `thoughtSignature`) are kept.
- Triage makes no LLM or network calls. Cost: $0.
- New behavior ships behind `TRIAGE_COMPACTION_ENABLED` (read as `=== "true"`, default off), matching the existing `RELEVANT_CONTEXT_SELECTION_ENABLED` escape-hatch pattern. With the flag off, output must be byte-identical to today.
- The replay harness only runs `SELECT` against the DB and never writes history back.
- Imports inside `packages/agent-runtime/src` use relative `./x.ts` paths (existing convention); `scripts/` imports `../packages/agent-runtime/src/x.ts`.
- Credit: the keep / truncate / stub idea is adapted from save-token-jev (MIT). Our own implementation; add a one-line credit in the `triage-compaction.ts` header.
- Internal agent names may appear in code and logs, never in user-facing output.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `packages/agent-runtime/src/history-validate.ts` | Create | Pure validators: list pairing violations for Gemini, NIM and Claude histories |
| `packages/agent-runtime/src/history-validate.test.ts` | Create | Validator tests |
| `packages/agent-runtime/src/compaction.ts` | Modify | Block-aware `estimateTokenCount`; pairing-safe trailing window in `compactHistory`; screenshots stripped from the summarizer prompt |
| `packages/agent-runtime/src/compaction.test.ts` | Modify | Tests for the two bug fixes |
| `packages/agent-runtime/src/claude-loop.ts` | Modify | Drop the `as any` casts at the `compactHistory` call (typed generic) |
| `packages/agent-runtime/src/json-caps.ts` | Create | `capString(s, max)` / `capJsonStrings(v, max)`, moved out of context-selection so triage can reuse them without an import cycle |
| `packages/agent-runtime/src/context-selection.ts` | Modify | Import caps from `json-caps.ts` (no behavior change); optional triaged middle in `selectRelevantContext` |
| `packages/agent-runtime/src/triage-rules.ts` | Create | Pure rules: `TriageCall[]` → `TriageDecision[]` |
| `packages/agent-runtime/src/triage-rules.test.ts` | Create | Rule tests |
| `packages/agent-runtime/src/triage-compaction.ts` | Create | Collect calls from Gemini turns, apply decisions, enforce the token budget, return triaged middle + stats |
| `packages/agent-runtime/src/triage-compaction.test.ts` | Create | Core tests (pairing, idempotency, budget, thought parts untouched) |
| `packages/agent-runtime/src/context-selection.test.ts` | Modify | Flag-off identity test; flag-on "QA evidence survives" test |
| `packages/agent-runtime/src/gemini-loop.ts` | Modify | Pass `triageMiddle` option at both primary compaction call sites when the flag is on |
| `scripts/compaction-replay.ts` | Create | Replay every real saved history through current vs triage compaction; report metrics |
| `scripts/compaction-replay.test.ts` | Create | Metric-function tests on a synthetic history |

---

### Task 1: History pairing validators

**Files:**
- Create: `packages/agent-runtime/src/history-validate.ts`
- Test: `packages/agent-runtime/src/history-validate.test.ts`

**Interfaces:**
- Produces: `findGeminiPairingViolations(messages: GeminiMessage[]): string[]`, `findNimPairingViolations(messages: NimMessage[]): string[]`, `findClaudePairingViolations(messages: ClaudeMessage[]): string[]` (empty array = valid)

- [ ] **Step 1: Write the failing tests**
```typescript
import { test, expect } from "bun:test";
import type { GeminiMessage, NimMessage, ClaudeMessage } from "@nexsidi/llm-client";
import { findGeminiPairingViolations, findNimPairingViolations, findClaudePairingViolations } from "./history-validate.ts";

const call = (id: string, name = "read_file") => ({ id, type: "function" as const, function: { name, arguments: "{}" } });

test("NIM: valid call/result sequence has no violations", () => {
  const m: NimMessage[] = [
    { role: "system", content: "s" }, { role: "user", content: "t" },
    { role: "assistant", content: null, tool_calls: [call("a"), call("b")] },
    { role: "tool", tool_call_id: "a", content: "1" }, { role: "tool", tool_call_id: "b", content: "2" },
  ];
  expect(findNimPairingViolations(m)).toEqual([]);
});

test("NIM: tool result whose call is not directly before it is a violation", () => {
  const m: NimMessage[] = [{ role: "user", content: "summary" }, { role: "tool", tool_call_id: "a", content: "1" }];
  expect(findNimPairingViolations(m)).toEqual(["tool result a at 1 has no matching call"]);
});

test("NIM: call with no result (not the last message) is a violation", () => {
  const m: NimMessage[] = [
    { role: "assistant", content: null, tool_calls: [call("a")] }, { role: "user", content: "next" },
  ];
  expect(findNimPairingViolations(m)).toEqual(["tool call a at 0 has no result"]);
});

test("Gemini: functionResponse turn must follow a model turn with the same call names in order", () => {
  const ok: GeminiMessage[] = [
    { role: "model", content: [{ functionCall: { name: "read_file", args: {} } }] },
    { role: "user", content: [{ functionResponse: { name: "read_file", response: {} } }] },
  ];
  const orphan: GeminiMessage[] = [{ role: "user", content: [{ functionResponse: { name: "read_file", response: {} } }] }];
  expect(findGeminiPairingViolations(ok)).toEqual([]);
  expect(findGeminiPairingViolations(orphan)).toEqual(["functionResponse turn at 0 does not follow a matching functionCall turn"]);
});

test("Claude: tool_result must answer a tool_use in the directly preceding assistant message", () => {
  const ok: ClaudeMessage[] = [
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] },
  ];
  const orphan: ClaudeMessage[] = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] }];
  expect(findClaudePairingViolations(ok)).toEqual([]);
  expect(findClaudePairingViolations(orphan)).toEqual(["tool_result t1 at 0 has no matching tool_use"]);
});
```
- [ ] **Step 2: Run, verify it FAILS**
Run: `bun test packages/agent-runtime/src/history-validate.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Minimal implementation**
```typescript
import type { GeminiMessage, NimMessage, ClaudeMessage } from "@nexsidi/llm-client";

export function findNimPairingViolations(messages: NimMessage[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => {
    if (m.role === "tool") {
      let j = i - 1;
      while (j >= 0 && messages[j]!.role === "tool") j--;
      const owner = messages[j];
      const ids = owner && owner.role === "assistant" ? (owner.tool_calls ?? []).map((c) => c.id) : [];
      if (!ids.includes(m.tool_call_id)) out.push(`tool result ${m.tool_call_id} at ${i} has no matching call`);
    }
    if (m.role === "assistant" && m.tool_calls?.length && i < messages.length - 1) {
      const answered = new Set<string>();
      for (let k = i + 1; k < messages.length && messages[k]!.role === "tool"; k++) answered.add((messages[k] as { tool_call_id: string }).tool_call_id);
      for (const c of m.tool_calls) if (!answered.has(c.id)) out.push(`tool call ${c.id} at ${i} has no result`);
    }
  });
  return out;
}

const callNames = (m: GeminiMessage | undefined) =>
  m && m.role === "model" && Array.isArray(m.content) ? m.content.flatMap((p) => ("functionCall" in p ? [p.functionCall.name] : [])) : [];
const responseNames = (m: GeminiMessage) =>
  Array.isArray(m.content) ? m.content.flatMap((p) => ("functionResponse" in p ? [p.functionResponse.name] : [])) : [];

export function findGeminiPairingViolations(messages: GeminiMessage[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => {
    const responses = responseNames(m);
    if (responses.length && JSON.stringify(callNames(messages[i - 1])) !== JSON.stringify(responses)) {
      out.push(`functionResponse turn at ${i} does not follow a matching functionCall turn`);
    }
    const calls = callNames(m);
    if (calls.length && i < messages.length - 1 && JSON.stringify(responseNames(messages[i + 1]!)) !== JSON.stringify(calls)) {
      out.push(`functionCall turn at ${i} is not answered by the next turn`);
    }
  });
  return out;
}

type Block = { type?: string; id?: string; tool_use_id?: string };
const blocks = (m: ClaudeMessage | undefined): Block[] => (m && Array.isArray(m.content) ? (m.content as Block[]) : []);

export function findClaudePairingViolations(messages: ClaudeMessage[]): string[] {
  const out: string[] = [];
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const useIds = prev?.role === "assistant" ? blocks(prev).filter((b) => b.type === "tool_use").map((b) => b.id) : [];
    for (const b of blocks(m)) {
      if (b.type === "tool_result" && !useIds.includes(b.tool_use_id)) out.push(`tool_result ${b.tool_use_id} at ${i} has no matching tool_use`);
    }
    if (m.role === "assistant" && i < messages.length - 1) {
      const answered = new Set(blocks(messages[i + 1]).filter((b) => b.type === "tool_result").map((b) => b.tool_use_id));
      for (const b of blocks(m)) if (b.type === "tool_use" && !answered.has(b.id)) out.push(`tool_use ${b.id} at ${i} has no tool_result`);
    }
  });
  return out;
}
```
- [ ] **Step 4: Run, verify it PASSES**, then `bun run typecheck` in `packages/agent-runtime`
- [ ] **Step 5: Commit** `feat(agent-runtime): history pairing validators for Gemini/NIM/Claude`

---

### Task 2: Fix NIM/Claude compaction (token estimate + pairing-safe trailing window)

**Files:**
- Modify: `packages/agent-runtime/src/compaction.ts` (`estimateTokenCount`, `compactHistory`)
- Modify: `packages/agent-runtime/src/claude-loop.ts:479-480` (remove `as any`)
- Test: `packages/agent-runtime/src/compaction.test.ts`

**Interfaces:**
- Consumes: `findNimPairingViolations`, `findClaudePairingViolations` (Task 1)
- Produces: `estimateTokenCount(messages: ReadonlyArray<{ role: string; content?: unknown; tool_calls?: unknown }>): number`; `compactHistory<T extends { role: string; content?: unknown }>(messages: T[], chat?: CompactionChat): Promise<T[]>`; `safeToolTrailingStart(messages, desiredCount, floor): number`

- [ ] **Step 1: Write the failing tests** (append to `compaction.test.ts`)
```typescript
import { findNimPairingViolations, findClaudePairingViolations } from "./history-validate.ts";

test("estimateTokenCount counts Claude blocks (was: 2 tokens for a ~50K-token history)", () => {
  const big = "x".repeat(200_000);
  const m = [
    { role: "system", content: "sys" }, { role: "user", content: "task" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: big }] },
  ];
  expect(estimateTokenCount(m)).toBeGreaterThan(50_000);
});

test("estimateTokenCount prices a Claude image block at a fixed 1,600 tokens, not its base64 length", () => {
  const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(400_000) } };
  const m = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [img] }] }];
  expect(estimateTokenCount(m)).toBe(1_600);
});

test("estimateTokenCount still returns 4 for the original 15-char string case", () => {
  expect(estimateTokenCount([{ role: "system", content: "hello world" }, { role: "user", content: "test" }])).toBe(4);
});

test("compactHistory never starts the trailing window on an orphaned NIM tool result", async () => {
  const huge = "x".repeat(130_000);
  const m: NimMessage[] = [
    { role: "system", content: "sys" }, { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a\"}" } }] },
    { role: "tool", tool_call_id: "c1", content: huge },
    { role: "assistant", content: null, tool_calls: [
      { id: "c2", type: "function", function: { name: "read_file", arguments: "{\"path\":\"b\"}" } },
      { id: "c3", type: "function", function: { name: "read_file", arguments: "{\"path\":\"c\"}" } },
    ] },
    { role: "tool", tool_call_id: "c2", content: "b" }, { role: "tool", tool_call_id: "c3", content: "c" },
    { role: "assistant", content: "done" }, { role: "user", content: "next" },
  ];
  const out = await compactHistory(m, mockChat);
  expect(findNimPairingViolations(out)).toEqual([]);
  expect(out.some((x) => x.role === "assistant" && x.tool_calls?.some((c) => c.id === "c2"))).toBe(true);
});

test("compactHistory on a Claude-shaped history compacts, stays paired, and sends no base64 to the summarizer", async () => {
  let prompt = "";
  const chat = async (msgs: Array<{ role: "user"; content: string }>) => { prompt = msgs[0]!.content; return { content: "SUMMARY" }; };
  const img = { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD".repeat(10) } };
  const big = "y".repeat(130_000);
  const m: ClaudeMessage[] = [
    { role: "system", content: "sys" }, { role: "user", content: "task" },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "screenshot", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: big }, img] }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "read_file", input: { path: "a" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "a" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t3", name: "read_file", input: { path: "b" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t3", content: "b" }] },
  ] as ClaudeMessage[];
  const out = await compactHistory(m, chat);
  expect(out.length).toBeLessThan(m.length);
  expect(findClaudePairingViolations(out)).toEqual([]);
  expect(prompt).not.toContain("QUJD");
  expect(prompt).toContain("[screenshot]");
});
```
(add `ClaudeMessage` to the existing type import from `@nexsidi/llm-client`)
- [ ] **Step 2: Run, verify the new tests FAIL** (`bun test packages/agent-runtime/src/compaction.test.ts`)
- [ ] **Step 3: Implementation** (replace `estimateTokenCount` and the trailing/middle split in `compactHistory`)
```typescript
// Claude bills an image by its pixel size (~1,600 tokens for a full screenshot), not by its base64 length.
const CLAUDE_IMAGE_TOKENS = 1_600;

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === "image") { n += CLAUDE_IMAGE_TOKENS * 4; continue; }
    if (typeof block.text === "string") n += block.text.length;
    if (block.type === "tool_use") n += JSON.stringify(block.input ?? {}).length;
    if (block.type === "tool_result") n += contentChars(block.content);
  }
  return n;
}

export function estimateTokenCount(messages: ReadonlyArray<{ role: string; content?: unknown; tool_calls?: unknown }>): number {
  let totalChars = 0;
  for (const m of messages) {
    totalChars += contentChars(m.content);
    if (m.tool_calls) totalChars += JSON.stringify(m.tool_calls).length;
  }
  return Math.round(totalChars / 4);
}

function isToolResultMessage(m: { role: string; content?: unknown }): boolean {
  if (m.role === "tool") return true;
  return m.role === "user" && Array.isArray(m.content) && (m.content as Array<{ type?: string }>).some((b) => b.type === "tool_result");
}

// Same hazard class as safeTrailingSlice (Gemini): walk the window start back so a
// tool result never appears without the assistant turn that called it.
export function safeToolTrailingStart(messages: ReadonlyArray<{ role: string; content?: unknown }>, desiredCount: number, floor: number): number {
  let start = Math.max(floor, messages.length - desiredCount);
  while (start > floor && isToolResultMessage(messages[start]!)) start--;
  return start;
}

function summarizable(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return (content as Array<Record<string, unknown>>).map((b) =>
    b.type === "image" ? { type: "text", text: "[screenshot]" }
    : b.type === "tool_result" ? { ...b, content: summarizable(b.content) }
    : b);
}
```
In `compactHistory` (made generic over `T extends { role: string; content?: unknown }`): replace the fixed `trailingCount = 4` slice with
```typescript
const start = safeToolTrailingStart(messages, 4, 2);
const trailingMessages = messages.slice(start);
const middleMessages = messages.slice(2, start);
if (middleMessages.length === 0) return messages;
```
and serialize the middle as `middleMessages.map((m) => ({ role: m.role, content: summarizable(m.content) }))`. The inserted summary message stays `{ role: "user", content: string }`, which is valid in both shapes. In `claude-loop.ts:479-480`, call `compactHistory(messages)` without the `as any` casts.
- [ ] **Step 4: Run all compaction tests (old + new) PASS; `bun test packages/agent-runtime/src/claude-loop.test.ts packages/agent-runtime/src/loop.test.ts` PASS; typecheck clean**
- [ ] **Step 5: Live API check (costs under $0.05, needs the Anthropic key already used by the escalation tier):** build a Claude-shaped history like the test above, run it through `compactHistory`, send it once to `claude-sonnet-5` with one trivial tool definition via `claudeChatWithTools`, and record that the API accepts it (no 400). The Claude path has never compacted before, so this proves the new shape is accepted, not assumed.
- [ ] **Step 6: Commit** `fix(agent-runtime): Claude-path compaction never fired (block-blind token estimate); pairing-safe trailing window`

---

### Task 3: Replay harness (measure before changing behavior)

**Files:**
- Create: `scripts/compaction-replay.ts`
- Test: `scripts/compaction-replay.test.ts`

**Interfaces:**
- Consumes: `compactViaRelevantContext`, `estimateGeminiTokenCount`, `findGeminiPairingViolations`
- Produces: `measureCompaction(before: GeminiMessage[], after: GeminiMessage[]): CompactionMetrics`, where

```typescript
export interface CompactionMetrics {
  tokensBefore: number;
  tokensAfter: number;
  pairingViolations: string[];
  callsBefore: number;              // functionCall parts in the input
  callsWithFullResultAfter: number; // calls whose original result text survives unchanged
  unresolvedErrorsBefore: number;   // status:"error" results with no later success on the same target
  unresolvedErrorsKept: number;
}
```

- [ ] **Step 1: Failing test**: a synthetic 12-turn history (one unresolved `http_request` error at turn 2, a `read_file` repeated at turns 3 and 9). `measureCompaction(h, h)` reports `unresolvedErrorsBefore: 1, unresolvedErrorsKept: 1`. `measureCompaction(h, compactViaRelevantContext(h, "task", [], 1))` reports `unresolvedErrorsKept: 0` (today's behavior drops it).
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement.**
  - `measureCompaction` pairs calls to responses by turn order, the same way as `collectCalls` in Task 4. Reuse that function once Task 4 lands; until then keep a local copy marked for replacement in Task 4 Step 3.
  - CLI: `bun scripts/compaction-replay.ts [--triage] [--files <glob>] [--out <path>]`.
  - Loads histories with one read-only query, `SELECT project_id, agent_name, messages, fact_ledger FROM agent_conversations`, using `DATABASE_URL`, plus any `--files`. De-duplicates by the sha256 of the messages JSON.
  - Keeps only Gemini-shaped histories over 120K estimated tokens. For each, runs `compactViaRelevantContext(messages, firstUserText, factLedger, 120_000)` and, with `--triage`, also runs it with `{ triageMiddle: { maxMiddleTokens: 40_000, targetTotalTokens: 60_000 } }`.
  - Writes per-history metrics as JSON, plus a totals table on stdout.
- [ ] **Step 4: Test PASSES; run for real:** `bun scripts/compaction-replay.ts --files "E:/tmp/nexsidi-builds/*/history-*.json" --out .nexsidi/sdd/compaction-replay-baseline.json`. Record baseline totals in the PR description: how many histories qualify, average tokens after, and unresolved errors kept (expected ~0%).
- [ ] **Step 5: Commit** `feat(scripts): compaction replay harness over real saved histories`

---

### Task 4: Triage rules + core (pure, not wired yet)

**Files:**
- Create: `packages/agent-runtime/src/json-caps.ts`. Move `capString`/`capJsonStrings` here from `context-selection.ts`, adding a `max` parameter that defaults to `4_000`. `context-selection.ts` imports them with no behavior change; its existing tests must still pass untouched.
- Create: `packages/agent-runtime/src/triage-rules.ts`, `packages/agent-runtime/src/triage-compaction.ts`
- Test: `packages/agent-runtime/src/triage-rules.test.ts`, `packages/agent-runtime/src/triage-compaction.test.ts`

**Interfaces:**
```typescript
// triage-rules.ts
export interface TriageCall {
  key: string;                 // `${callTurn}:${partIndex}`
  callTurn: number;            // index of the model turn in the middle array
  responseTurn: number;        // index of the user turn holding the functionResponse
  responsePart: number;        // part index of that functionResponse
  name: string;
  argsKey: string;             // argsKeyOf(args)
  target: string | null;       // path | command | "METHOD url" | "docker <action> <service>"
  resultChars: number;
  isError: boolean;            // response.status === "error"
  isStub: boolean;             // response.compacted === true (already stubbed earlier)
}
export type TriageAction = "keep" | "truncate" | "stub";
export interface TriageDecision { key: string; action: TriageAction; reason: string }
// Recursive sorted-key JSON. NOT JSON.stringify(args, Object.keys(args).sort()): a replacer
// array filters keys at every nesting level, so two calls differing only in a nested field
// (e.g. http_request headers) would collide and one would be wrongly stubbed as a repeat.
export function argsKeyOf(args: unknown): string;
export function targetOf(name: string, args: Record<string, unknown>): string | null;
export function decideByRules(calls: TriageCall[]): TriageDecision[];
export const LOG_KEEP_CHARS = 3_000;

// triage-compaction.ts
export interface TriageStats { calls: number; kept: number; truncated: number; stubbed: number; tokensBefore: number; tokensAfter: number }
export function collectCalls(middle: GeminiMessage[]): TriageCall[];
export function triageMiddle(middle: GeminiMessage[], budgetTokens: number): { turns: GeminiMessage[]; stats: TriageStats };
```

**Rules (newest to oldest, first match wins):**

| # | Condition | Action | Reason text |
|---|---|---|---|
| 1 | Already stubbed (`isStub`) | keep | already compacted |
| 2 | Same `name` + `argsKey` appears later | stub | same call repeated later |
| 3 | Error, and a later non-error call has the same `name` + `target` | stub | error resolved by a later successful call |
| 4 | Error (otherwise) | keep | unresolved error |
| 5 | `read_file` whose path is read again later, or later fully rewritten (`write_file`, `write_files`, `delete_file`) | stub | file re-read or rewritten later |
| 6 | `docker_compose` or `run_command` with result > `LOG_KEEP_CHARS` | truncate | long log: head and tail kept |
| 7 | Anything else | keep | no newer copy |

**Budget:** after the rules, if the middle is still over `budgetTokens`, change "keep" to "stub" oldest first: non-errors first, errors last.

- [ ] **Step 1: Failing tests** (rules):
```typescript
import { test, expect } from "bun:test";
import { decideByRules, targetOf, argsKeyOf, type TriageCall } from "./triage-rules.ts";

const c = (key: string, name: string, args: Record<string, unknown>, o: Partial<TriageCall> = {}): TriageCall => ({
  key, callTurn: 0, responseTurn: 1, responsePart: 0, name,
  argsKey: argsKeyOf(args), target: targetOf(name, args),
  resultChars: 100, isError: false, isStub: false, ...o,
});
const actions = (calls: TriageCall[]) => decideByRules(calls).map((d) => d.action);

test("argsKeyOf is key-order independent and keeps nested fields", () => {
  expect(argsKeyOf({ b: 1, a: { y: 2, x: 1 } })).toBe(argsKeyOf({ a: { x: 1, y: 2 }, b: 1 }));
  expect(argsKeyOf({ url: "u", headers: { auth: "1" } })).not.toBe(argsKeyOf({ url: "u", headers: { auth: "2" } }));
});

test("exact repeat: older copy stubbed, newest kept", () => {
  expect(actions([c("1", "read_file", { path: "a" }), c("2", "read_file", { path: "a" })])).toEqual(["stub", "keep"]);
});
test("unresolved error kept; resolved error stubbed", () => {
  const err = c("1", "http_request", { method: "POST", url: "http://localhost:3001/api/tasks", body: "{}" }, { isError: true });
  const ok = c("2", "http_request", { method: "POST", url: "http://localhost:3001/api/tasks", body: "{\"title\":\"x\"}" });
  expect(actions([err])).toEqual(["keep"]);
  expect(actions([err, ok])).toEqual(["stub", "keep"]);
});
test("read_file stubbed when the file is rewritten later, kept when only edited", () => {
  expect(actions([c("1", "read_file", { path: "a" }), c("2", "write_file", { path: "a", content: "x" })])).toEqual(["stub", "keep"]);
  expect(actions([c("1", "read_file", { path: "a" }), c("2", "edit_file", { path: "a", old_str: "x", new_str: "y" })])).toEqual(["keep", "keep"]);
});
test("long docker/run_command logs truncated, short ones kept", () => {
  expect(actions([c("1", "docker_compose", { action: "logs" }, { resultChars: 50_000 })])).toEqual(["truncate"]);
  expect(actions([c("1", "run_command", { command: "npx tsc --noEmit" }, { resultChars: 200 })])).toEqual(["keep"]);
});
test("already-stubbed calls are left alone (idempotent)", () => {
  expect(actions([c("1", "read_file", { path: "a" }, { isStub: true }), c("2", "read_file", { path: "a" })])).toEqual(["keep", "keep"]);
});
```
(core) in `triage-compaction.test.ts`:
  - The output has the same number of turns as the input, and `findGeminiPairingViolations` is empty.
  - A stubbed `functionResponse.response` becomes `{ status, compacted: true, summary: "[result omitted during compaction: <reason>; <name> <target>; <N> chars]" }`.
  - `thought` parts and `thoughtSignature` are deep-equal before and after.
  - All `inlineData` in the middle becomes `{ text: "[earlier screenshot omitted ...]" }`.
  - Running `triageMiddle` twice gives the same output as running it once.
  - Given a 300K-token synthetic middle and a budget of 40,000, `stats.tokensAfter` ≤ 40,000.
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement.**
  - `targetOf`:

    | Tool | Target |
    |---|---|
    | tool with a `path` arg | the path |
    | `run_command` | the command |
    | `http_request` | `"<METHOD> <url>"` |
    | `docker_compose` | `"docker <action> <service ?? all>"` |
    | anything else | `null` |

  - `write_files` marks every `files[].path` as rewritten.
  - `collectCalls` pairs each model turn's functionCall parts, in order, with the next user turn's functionResponse parts, matching by position and name. It skips unmatched ones, which never happen in valid history (`findGeminiPairingViolations` is empty).
  - Apply decisions by rewriting only `functionResponse.response`. For truncate, use `capJsonStrings(response, LOG_KEEP_CHARS)` from `json-caps.ts`.
  - Replace `inlineData` with the placeholder, and cap non-thought text parts with `capString(text, 4_000)`.
  - Replace the Task 3 local pairing copy with `collectCalls`.
  - Header credit: `// keep / truncate / stub triage adapted from save-token-jev (MIT)`.
- [ ] **Step 4: PASS; existing `context-selection.test.ts` still PASSES unchanged (json-caps move is behavior-neutral); typecheck clean**
- [ ] **Step 5: Commit** `feat(agent-runtime): deterministic triage rules + Gemini triage core (not wired)`

---

### Task 5: Wire triage into selectRelevantContext behind the flag

**Files:**
- Modify: `packages/agent-runtime/src/context-selection.ts` (`SelectContextOptions`, `selectRelevantContext`)
- Modify: `packages/agent-runtime/src/gemini-loop.ts` (call sites at `:426-428` and `:612-614`)
- Test: `packages/agent-runtime/src/context-selection.test.ts`

**Interfaces:**
- `SelectContextOptions.triageMiddle?: { maxMiddleTokens: number; targetTotalTokens: number }`. The middle's budget is `min(maxMiddleTokens, targetTotalTokens − tokens(system + taskMsg + ledgerMsg + trailing))`, floored at 0. With a very large system prompt the middle shrinks to fit; it never pushes the total past the target.
- `gemini-loop.ts`: `export const TRIAGE_MAX_MIDDLE_TOKENS = 40_000;`, `export const TRIAGE_TARGET_TOTAL_TOKENS = 60_000;` and `function isTriageCompactionEnabled(): boolean { return process.env.TRIAGE_COMPACTION_ENABLED === "true"; }`

- [ ] **Step 1: Failing tests**
  - **Flag off:** `selectRelevantContext(h, task, files, [], ledger)` output is `toEqual` a snapshot taken from the current implementation (commit the fixture). This locks in "byte-identical when off".
  - **QA evidence survives:** in a 100-turn QA-style history, turn 5 is an `http_request` with `status: "error"` ("POST /api/tasks → 500") that is never resolved, and the fact ledger is empty. With `{ triageMiddle: { maxMiddleTokens: 40_000, targetTotalTokens: 60_000 } }` the output still contains that response verbatim. Without the option it does not (today's amnesia).
  - **Large system prompt:** with a 50,000-token system prompt, the middle budget becomes ~10,000 minus the trailing window, and the total stays ≤ 60,000.
  - **Order and pairing:** the output order is `[system, taskMsg, ledgerMsg?, ...triagedMiddle, ...trailing]` and `findGeminiPairingViolations(output)` is empty.
  - **No duplicate task:** a leading middle user message whose text equals `currentTask` is not repeated.
  - **Size:** the result is ≤ 60,000 estimated tokens for a 580K-token input, so a 120K threshold does not immediately re-trigger.
- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement.**
  - Take `middle = nonSys.slice(0, nonSys.length - trailingRawCount)`, where `trailingRawCount` is the length of `safeTrailingSlice(nonSys, n)` before capping.
  - Drop the leading user message if it equals `currentTask`.
  - If the first middle turn is a functionResponse turn (its call was not kept), drop it; `findGeminiPairingViolations` must stay empty.
  - Compute the middle budget as described in Interfaces, run `triageMiddle(middle, budget)`, splice the result in before `trailing`, and log `[triage-compaction] middle: N calls → kept K, truncated T, stubbed S; ~X → ~Y tokens`.
  - In `gemini-loop.ts`, pass `isTriageCompactionEnabled() ? { triageMiddle: { maxMiddleTokens: TRIAGE_MAX_MIDDLE_TOKENS, targetTotalTokens: TRIAGE_TARGET_TOTAL_TOKENS } } : {}` as the `options` argument of both `compactViaRelevantContext` calls. The emergency fallback at `:700` stays unchanged.
- [ ] **Step 4: PASS; full `bun test packages/agent-runtime` PASS; typecheck clean**
- [ ] **Step 5: Commit** `feat(agent-runtime): optional triaged middle in relevant-context compaction (TRIAGE_COMPACTION_ENABLED, default off)`

---

### Task 6: Replay gate on all real histories

- [ ] **Step 1:** Run `bun scripts/compaction-replay.ts --triage --files "E:/tmp/nexsidi-builds/*/history-*.json" --out .nexsidi/sdd/compaction-replay-triage.json`, which reads the DB via `DATABASE_URL` plus the disk files.
- [ ] **Step 2: Acceptance (all must hold; otherwise stop and report, don't tune blindly):**
  1. 0 pairing violations in every output, both modes.
  2. Triage output ≤ 60,000 estimated tokens for 100% of histories.
  3. Triage keeps 100% of unresolved error results from the middle. Report today's number next to it.
  4. Triage adds < 50 ms per compaction on the largest (~580K) history (`performance.now()` around `triageMiddle`).
  5. Report the share of non-repeated `http_request`, `browser_*` and `read_file` results kept, per agent. There's no pass/fail number yet; Amit reviews it.
- [ ] **Step 3:** Append the totals table for both modes to this plan under "Results", and commit the harness outputs to `.nexsidi/sdd/`.

---

### Task 7: Live A/B on one real build (needs Amit's go-ahead: two normal builds of spend and time)

- [ ] **Step 1:** Run the same build prompt twice, once with `TRIAGE_COMPACTION_ENABLED` unset and once with `=true`. Use a fresh project each time, and a prompt that exercises QA (signup + CRUD + persistence).
- [ ] **Step 2: Compare from logs/DB:**
  - compaction events per agent
  - total input tokens and spend (cost-budget / recordSpend logs)
  - repeated identical `http_request` calls after a compaction (a sign the agent forgot)
  - final QA verdict and whether the app works (sign up, 3 tasks, check 2, refresh, data persists)
- [ ] **Step 3:** Write up the comparison. Change the default to on (`!== "false"`) only if the triage run is not worse on quality and not more expensive, and **only with Amit's approval**. That would be a separate one-line commit.

---

## Out of scope (separate plans)

- **Laya scorer (Step B):** later, calls the rules mark "keep: no newer copy" (rule 7) can be sent to the local laya-server as yes/no questions. `decideByRules` keeps them for now.
- **Adding QA evidence to the fact ledger** (`http_request` non-2xx, browser console errors) as a complementary fix to the empty ledger. This is worth a separate small plan once Task 6 shows how much triage alone recovers.
- **Triage for the NIM/Claude loops:** 0 of 124 saved conversations use them; they only get the bug fixes in Task 2.
- **Hosted Jev:** not safe as-is (sends system prompts and unredacted tool inputs).

## Self-review

- Coverage: every problem in "Evidence" maps to a task. Claude estimate → 2; NIM/Claude pairing → 2; Gemini middle dropped wholesale → 4, 5; QA empty ledger → 5 (evidence test), 7; "measure first" → 3, 6.
- No placeholders: rules, thresholds (120,000 / 40,000 / 60,000 / 3,000 / 4,000 / 1,600) and marker strings are all concrete.
- Names consistent: `triageMiddle`, `collectCalls`, `decideByRules`, `targetOf`, `argsKeyOf`, `TriageCall`, `TriageDecision`, `TRIAGE_COMPACTION_ENABLED`, `TRIAGE_MAX_MIDDLE_TOKENS`, `TRIAGE_TARGET_TOTAL_TOKENS`, `find*PairingViolations`, `safeToolTrailingStart`, `measureCompaction`.
- Hand-checked against the code: the Task 2 NIM case walks the window start from index 5 (tool) back to 4 (the assistant turn with c2/c3). The Claude case compacts 8 → 7 messages with the image replaced by `[screenshot]`. The legacy "15 chars → 4" and "8 → 7 messages" tests still hold.

## Results

### Tasks 1-5: done (2026-09-26)
Commits: d15dd08 (validators), 8cee4ad (NIM/Claude fixes), 2fd022a (replay harness), f189064 (rules + core), 8fb3e28 (wiring, flag default off). 403/403 agent-runtime tests pass; typecheck clean.
- Task 2 Step 5 (live Claude API check) **not done**: the Anthropic API rejected the request with "credit balance is too low" before looking at it, and Vertex is not configured. Structure verified by `findClaudePairingViolations` only. This also means the Claude escalation tier cannot run on the current key.
- Validator correction from real data: all 346 unanswered Gemini calls across every saved history are `task_complete` followed by user text (run boundary, which Gemini accepted). Only that exact case is exempt.

### Task 6 gate: 22 unique histories over 120K (165 sources, 19 duplicates)

| Metric | Current | Triage | Criterion |
|---|---|---|---|
| Avg tokens after (before: 233,641) | 13,510 | 38,333 | - |
| Max tokens after | 34,716 | 59,460 | 2. <= 60,000: **pass** |
| Histories with pairing violations | 0 | 0 | 1. 0: **pass** |
| Unresolved errors kept (of 123) | 1 | 52 | 3. 100%: **FAIL** |
| Latest result per distinct call kept (of 1,505) | 54 | 420 | 5. report only |
| Tool results kept verbatim (of 2,355) | 185 | 629 | - |
| Max ms per compaction | 1 | 15 | 4. < 50 ms: **pass** |

**Why criterion 3 fails (measured, not guessed):** system prompts are small (3-15K tokens) and most histories get the full 40K middle budget. In the failing histories the middle is dominated by content triage never shrinks: `write_file`/`write_files` call arguments (46-93K tokens) and the model's own text (up to 306K tokens in one shubham history). Even with every result stubbed, the floor exceeds 40K, so the fallback drops the OLDEST turns wholesale and takes the errors with them. QA agents mostly pass (their middles are small apart from images, which are replaced).

Stopped here per this plan's rule ("stop and report, don't tune blindly"). Options for Amit:
- **C (within current rules):** when the budget still doesn't fit, drop non-error turn pairs (oldest first) instead of a contiguous oldest prefix, so unresolved errors are never the ones dropped.
- **A (changes a global constraint):** allow the triage pass to replace the file content in superseded `write_file`/`write_files`/`edit_file` call args (file rewritten later) with a one-line note. The trailing window already caps functionCall args live, so the API accepts modified args; it is the biggest part of the floor.
- **B:** cap old model text in the middle harder (e.g. 1,000 chars per text part).
- **D:** raise the 60K target (must stay well under the 120K threshold).

Outputs: `.nexsidi/sdd/compaction-replay-baseline.json`, `.nexsidi/sdd/compaction-replay-triage.json`.
Task 7 (live A/B build) not started: waits on this decision and on Amit's go-ahead.

### Task 6 gate re-run after Amit-approved fixes (2026-09-27): all criteria pass

Changes (options C + A): the fallback drops whole call+response units oldest first but never a unit holding an unresolved error; the budget step never stubs unresolved errors; stale file content in superseded write/edit call args is replaced by a note.

| Metric | Current | Triage v1 | **Triage v2** | Criterion |
|---|---|---|---|---|
| Max tokens after | 34,716 | 59,460 | **59,805** | 2. <= 60,000: **pass** |
| Histories with pairing violations | 0 | 0 | **0** | 1. 0: **pass** |
| Unresolved errors kept (of 123) | 1 | 52 | **123** | 3. 100%: **pass** |
| Max ms per compaction | 3 | 15 | **24** | 4. < 50 ms: **pass** |
| Latest result per distinct call kept (of 1,505) | 54 | 420 | **481** | 5. report |
| Tool results kept verbatim (of 2,355) | 185 | 629 | **809** | - |

Criterion 5 per agent (latest results kept, current -> triage v2): tilotma-evidence-collector 6 -> 90 of 90, tilotma-live-eval 6 -> 71 of 71, tilotma-reality-checker 12 -> 155 of 334, aanya 18 -> 153 of 557, riya 6 -> 6 of 6, **shubham 6 -> 6 of 447**. Shubham's middles are almost entirely model text (up to 306K tokens), which option B (cap old model text) would address; not approved, so not done. All unresolved errors are kept for every agent.

The "current" column is identical to the 2026-09-26 baseline, so behavior with the flag off is unchanged.

Next: Task 7 (live A/B on a real build) needs Amit's go-ahead; `TRIAGE_COMPACTION_ENABLED` stays off until then.
