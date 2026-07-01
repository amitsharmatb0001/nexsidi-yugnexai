# Full Agentic Pipeline — Design

**Status:** Approved by Amit, pending write-up review
**Date:** 2026-07-01

## Context

NexSidi's pipeline today generates code via one-shot LLM calls: prompt in, text out, parsed into files. No agent actually verifies its own output against real behavior, no agent talks to another agent with verified context, and nothing resembles the multi-agent system described in the filed patent documents. This design closes that gap.

Two things forced this redesign:

1. **Honesty gap.** During Sprint 1 (task-manager rebuild), 8 real bugs were found and fixed — all by a human reading Docker logs and editing files by hand, not by any agent. The system was claimed as "agentic" when it was a code-generator with a TypeScript compile check.
2. **Patent alignment.** Two documents govern what NexSidi is legally claiming to have built:
   - `Form2_Provisional_Specification_YUGNEX.md` — the filed provisional (10 claims: DAG task decomposition, capability-based agent routing, SHA-256 context hash chain with auto-rollback, bidirectional traceability, 3 independent error-maximizing adversarial agents, 4-tier kernel isolation, convergence detection, mistake memory)
   - `YUGNEX_AI_PLATFORM_DUAL_SPECIFICATION.md` — the detailed, current product spec (6-stage pipeline, feature-flagged approval gates, UI-first sequencing, 3-tier QA with zero-tolerance security)

   CLAUDE.md's internal "10 PATENT CLAIMS" summary table does not match the actual filed provisional (it lists RSA signing, OTP/PIN approval, and a "Chief AI Officer" pattern as claims — none of which are in the filed document; it's missing DAG decomposition, capability routing, and bidirectional traceability, which are). This design builds against the actual filed documents, not the CLAUDE.md summary. Reconciling CLAUDE.md's table is a follow-up, not part of this design.

The core goal: every mechanism this design specifies must actually run, so the eventual complete specification (due within 12 months of the provisional filing) describes a system that exists, not one that's aspirational.

## Non-Goals (explicitly deferred, not part of this design)

- **Temporal orchestration** — stages are plain async functions now, shaped to be a clean drop-in for `proxyActivities()` later. Not wired to Temporal in this design.
- **Real OTP + payment processing** — both are feature flags (`requireOtp`, `requirePayment`), both `false` right now. The approval gate is a Claude-Code-style Proceed/Review prompt.
- **GCP / live cloud deployment** — `deployTarget` flag, `"local"` (Docker Compose) now, `"gcp"` built later behind the same flag.
- **Dynamic per-project language/stack selection** (Node/Python/PHP as the dual-spec describes Tilotma spinning up) — capability-based routing is designed generically enough to support this later, but the actual capability pool right now is still the fixed Sprint 1 stack (Express/Next.js/Postgres).
- **Multi-lingual (English/Hindi) requirement gathering UX** — noted as a real requirement from the dual-spec, not designed here; product/UX layer work for a later pass.
- **Filing-date reconciliation** between the two patent documents — Amit's responsibility, not a technical blocker.

## Architecture Overview

Six stages, direct async orchestration (no Temporal dependency), file-checkpointed after each stage so a crash resumes from the last completed stage instead of from zero:

```
STAGE_1_REQUIREMENTS   → Saanvi: spec doc + DAG task graph
        ↓ [checkpoint: 01-requirements.json]
STAGE_2_GATEWAY         → Proceed / Review gate. requireOtp/requirePayment flags (off).
        ↓ [checkpoint: 02-gateway.json]
STAGE_3_UI_PREVIEW      → Aanya: visual-only UI, mock data. Proceed/Review. Design LOCKS.
        ↓ [checkpoint: 03-ui-preview.json]
STAGE_4_MULTI_AGENT_DEV → Shubham + Pranav (parallel where DAG allows) + Aanya integration.
        ↓ [checkpoint: 04-dev.json]              [STRESS TEST 1: basic app, Stages 1-4]
STAGE_5_ADVERSARIAL_QA  → 3-tier QA (self-review, adversarial trio, Tilotma final review).
        ↓ [checkpoint: 05-qa.json]                [STRESS TEST 2: harder app, Stages 1-5]
STAGE_6_DEPLOYMENT      → Riya: local Docker Compose now, gcp flagged for later. Live retest.
        ↓ [checkpoint: 06-deployment.json]        [STRESS TEST 3: mid-advanced app(s), full pipeline]
                        → DONE. Generic-labeled delivery: URL + repo + feature list.
```

Every stage function has a plain typed signature — `(input) => Promise<output>` — no hidden state, nothing Temporal-specific. This is what makes the later Temporal swap-in possible without rewriting stage logic:

```typescript
// Now:
const spec = await runRequirementsStage(userInput);
// Later, same function, different caller:
const { runRequirementsStage } = proxyActivities<typeof activities>({...});
```

## Confidentiality / Naming (applies to every stage)

Only generic labels are ever shown externally — to users, outside developers, or investors. Internal agent names never surface outside this codebase. This reinforces CLAUDE.md's existing confidentiality rule, applied concretely per stage:

| External label | Internal reality |
|---|---|
| "Chat with Planner" | Saanvi gathering requirements |
| "Design Preview" | Aanya's Stage 3 UI build |
| "Building your app... 40%" | Shubham/Pranav/Aanya in Stage 4, generic progress % only |
| "Running quality checks..." | Navya/Karan/Deepika + Tilotma's Stage 5 review — no scores, no iteration count shown |
| Final delivery: URL + repo + feature list | Everything else — architecture, agent count, QA internals — stays hidden, always |

## Stage 1 — Requirements (Saanvi)

- Accepts natural language input (English/Hindi UX deferred, backend should not assume English-only)
- "No guesswork, no hallucination" policy: ambiguity (theme, target audience, customization, typography) triggers a targeted clarifying questionnaire, not an assumption
- Gets `web_search` tool access — used to research current best practices and verify real library/package existence before committing to them in the spec (directly addresses the `@radix-ui/react-badge` hallucination bug from Sprint 1)
- Produces: (1) a professional spec doc, (2) a DAG task graph — real vertices/edges, complexity-scored, cycle-detected

## Stage 2 — Gateway

- Spec doc shown to user with a Proceed / Review two-button gate (same UX pattern as Claude Code plan-mode)
- `requireOtp` / `requirePayment` flags checked here — both `false` currently
- On Review: spec returns to Stage 1 with feedback; no agent work has started, nothing to roll back

## Stage 3 — UI Preview (Aanya)

- Builds visual-only screens using NexSidi UI (`@yugnex/nexui-react`, `@yugnex/nexui`) — **no Tailwind, no shadcn/ui, no third-party component libraries** — with mock/placeholder data, no real API calls
- Same Proceed/Review gate, scoped to the design specifically
- On Proceed: design **locks** to a design-lock file; Stage 4's Aanya work is wiring this exact UI to real data, not redesigning it
- On Review: only Stage 3 repeats; Stage 1's spec is untouched

## Stage 4 — Multi-Agent Dev

- Tilotma assigns DAG task vertices to agents via capability matching (not hardcoded assignment — generalizes to future dynamic stack selection, not built now)
- Sequencing follows real DAG dependency edges: Pranav (DB schema) and Shubham (backend scaffolding) start in parallel since schema doesn't depend on backend code; Aanya's integration task depends-on Shubham's self-tested backend completion
- Shubham builds via the real agent tool loop (`packages/agent-runtime`, already built — see "Relationship to Existing Code" below): writes files, runs `npm install`, runs `tsc`, and **self-tests its own APIs via `http_request`** before declaring done (this is QA Tier 1, folded into Stage 4)
- Shubham (and Aanya, for frontend packages) get `web_search` access to verify a package actually exists and check its current version before adding it to `package.json` — this is the direct fix for the `@radix-ui/react-badge` hallucination bug from Sprint 1 (a package that doesn't exist on npm, added because the model hallucinated it)
- **Context hash chain actually invoked for real**: every agent-to-agent handoff (Pranav→Shubham, Shubham→Aanya) is SHA-256 hashed, verified on receipt, automatic rollback to last verified state on mismatch — fixing the previously-existing gap where this code existed in `packages/context-chain/` but was never called by the running pipeline
- **Bidirectional traceability**: every file an agent writes is tagged with which Stage 1 requirement it satisfies — enables Stage 5 Tier 3's completeness check and forward-traces debugging
- **Stress test checkpoint 1**: basic app runs through Stages 1-4 once this stage is built

## Stage 5 — Adversarial QA (3 tiers)

**Tier 1 — Agent Self-Review**: covered in Stage 4 (Shubham self-testing before handoff).

**Tier 2 — Adversarial trio, competitive parallel, prompts framed as "maximize error detection" (not "check correctness")**:

| Agent | Technique |
|---|---|
| Navya — Logical | Type inconsistencies, null references, algorithmic flaws, unreachable code |
| Karan — Security | OWASP Top 10 + CVE cross-referencing + taint analysis (untrusted input → sensitive sinks) + generates and tries real attack payloads (SQLi, XSS) via `http_request` |
| Deepika — Performance | Big-O complexity estimation, memory leak detection via allocation pattern analysis, N+1/blocking call detection |

**Threshold split**: Logic and Performance use the existing severity-weighted score (≥85/100, per `nexsidi-adversarial-qa`). **Security is zero-tolerance** — any finding blocks, full stop, no partial credit (matches the dual-spec's "even 0.1% vulnerability triggers rejection").

**Tier 3 — Tilotma's final review**: reuses the existing `nexsidi-agency-engineers` two-stage evidence-based design (Aarav Stage 1 Evidence Collector — screenshots, default-assume issues exist; Stage 2 Reality Checker — independently re-verify Stage 1's findings, skeptical by default, "NEEDS WORK" unless evidence overwhelmingly says otherwise), cross-referenced against the Stage 1 spec and Stage 3 locked design via the Stage 4 traceability links.
  - **Open implementation item**: requires a new screenshot/browser tool added to `packages/agent-runtime` — Phase 1's file/command/http/docker tools aren't sufficient for real visual verification. Noted as implementation scope for the plan, not designed in detail here.

**On any Tier 2/3 failure**: mistake memory records the pattern → routes back to Stage 4, but only to the specific agent actually at fault (fault-isolated, not blind full-regenerate) → once patched, Stage 5 re-runs as a **full 100% retest**, not a spot-check of the fix.

**Stress test checkpoint 2**: a harder app runs through Stages 1-5 once this stage is built.

## Stage 6 — Deployment (Riya)

- `deployTarget` flag: `"local"` now (Docker Compose, same pattern as Sprint 1), `"gcp"` behind the same flag for later
- **Live retest**: Stage 5's QA re-runs against the actually-deployed instance, not just the pre-deploy build — this is what would have caught Sprint 1's CORS-origin-mismatch and unmounted-routes bugs immediately, since those were deploy-config issues invisible before containers were actually running
- User handoff: generic labels only; local mode delivers localhost URL + repo link; custom domain step deferred to the GCP path
- **Stress test checkpoint 3 (final)**: mid-advanced app(s) run through the complete Stages 1-6 pipeline

## Error Handling (cross-cutting)

| Failure point | Mechanism |
|---|---|
| Stage-to-stage crash | File checkpoint, resume from last completed stage |
| Agent-to-agent handoff | SHA-256 context hash + automatic rollback on mismatch |
| LLM API call failure | Existing 4-tier fallback chain + circuit breaker in `packages/llm-client` (unchanged, plugs in underneath) |
| QA failure | Fault-isolated targeted re-fix → full 100% retest, never partial |

## Testing Strategy

- Every agent self-verifies via real tool execution (write → run → observe → fix), never "should work"
- 3-tier QA as specified in Stage 5
- 2-4 real apps, basic → mid-advanced, tested **incrementally** at 3 checkpoints (after Stage 4, after Stage 5, after Stage 6) rather than saved for one final test — catches bugs when they're cheapest to fix, matching Sprint 1's actual bug history (all 8 bugs were in generation/wiring/QA, not deployment)
- This incremental stress-test run is mandatory self-verification before this design is considered proven, not an informal claim

## Relationship to Existing Code

- **`packages/agent-runtime/`** (already built, reviewed in this session): the tool-calling loop — `write_file`, `read_file`, `list_files`, `run_command` (allowlisted), `http_request` (localhost-only), `docker_compose`, `task_complete` (requires `verification_passed`). This underpins every agent's work from Stage 4 onward. New tools needed for this design: `web_search` (Stage 1+), a screenshot/browser tool (Stage 5 Tier 3) — both implementation scope, not designed in detail here.
- **NexSidi UI** (`@yugnex/nexui`, `@yugnex/nexui-react`): already decided in this session, replaces Tailwind/shadcn/ui in all generated frontend work — applies to Stage 3 and Stage 4's Aanya work.
- **`agents/generators/shubham`, `agents/generators/aanya`, `agents/riya`**: already partially rewritten this session to use the tool loop; this design supersedes the parallel-dispatch assumption in those files with the DAG-driven, UI-first sequencing described in Stages 3-4.
- **`packages/context-chain/`**: exists, previously unused by the running pipeline — this design requires it actually be invoked at every Stage 4 handoff.

## Patent Alignment (mechanisms this design makes real, not just described)

| Provisional claim | This design's mechanism |
|---|---|
| DAG task decomposition | Stage 1 — real graph, complexity-scored, cycle-detected |
| Capability-based agent routing | Stage 4 — Tilotma assigns by capability match, not hardcoded |
| SHA-256 context hash + auto-rollback | Stage 4 — invoked on every real handoff (previously unused code, now wired in) |
| Bidirectional traceability | Stage 4 — every artifact tags its source requirement |
| 3 independent error-maximizing adversarial agents | Stage 5 Tier 2 — Navya/Karan/Deepika, competitive parallel, explicit maximize-error framing |
| Kernel isolation (namespaces/cgroups/seccomp/iptables) | Already real via Docker (WSL2 backend on Windows runs a genuine Linux kernel) — no rewrite needed, configure explicitly rather than rely on Docker defaults |
| Convergence detection / iteration limits | Stage 5 on-fail loop — full retest with fault isolation, not unbounded retry |
| Mistake memory with pattern extraction | Stage 5 on-fail — records pattern, informs future agent prompts |

## Open Follow-Ups (not blocking this design)

1. Reconcile CLAUDE.md's internal "10 PATENT CLAIMS" table against the actual filed provisional — they currently don't match.
2. Confirm actual provisional filing date (this doc says Dec 31 2025, CLAUDE.md says Jan 5 2026) — Amit's responsibility.
3. Design the screenshot/browser tool for Stage 5 Tier 3 (implementation-plan scope).
4. Design real OTP/payment integration when pricing is decided (currently feature-flagged off).
5. Design GCP deploy path when needed (currently feature-flagged off).
