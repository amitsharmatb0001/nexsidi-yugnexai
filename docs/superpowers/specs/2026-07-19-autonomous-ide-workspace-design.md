# NexSidi Autonomous IDE Workspace - Design

**Status:** Approved by Amit; pending repository write-up review

**Date:** 2026-07-19

**Supersedes:** The planner, approval, user-visible activity, attachment, and plan-to-build handoff portions of `2026-07-01-full-agentic-pipeline-design.md`

## 1. Purpose

NexSidi must operate as a safe autonomous software-development workspace, not as a chat interface wrapped around a code-generation pipeline.

The user experience begins with an incomplete natural-language request and ends with verified delivery:

```text
Request
  -> clarify only material uncertainty
  -> produce an exact, reviewable plan
  -> accept or revise that versioned plan
  -> execute the approved work visibly
  -> run and inspect the application
  -> repair failures
  -> verify the complete result
  -> deliver source, preview, tests, and documentation
```

The interface may be informed by the clarity of contemporary coding IDE agents, but it must have its own interaction model and visual identity. It must never expose confidential internal identities, counts, model routing, system prompts, or architecture.

## 2. Problem Statement and Confirmed Root Causes

The current planning/build experience fails for structural reasons:

1. The initial URL prompt can race the asynchronous session load and be submitted twice.
2. A streamed assistant response can be appended on both the stream `done` event and stream closure.
3. Clarification limits and stage transitions exist mainly as model instructions, not enforced application state.
4. Progress depends on conversational phrases such as `go ahead` and `build it` instead of explicit transitions.
5. The proposed plan exists in browser memory and is lost on reload or reconnect.
6. Accepting a plan sends another chat message rather than approving and executing the displayed structured object.
7. The accepted plan is flattened to prose, regenerated as requirements, regenerated again as a technical plan, and then expanded by generators. This permits plan/build drift.
8. Some generator instructions force authentication and associated data structures regardless of approved scope.
9. Binary attachments are represented to the planner primarily by metadata rather than parsed content.
10. The build page is a large UI monolith without durable workspace navigation, evidence, approvals, sources, or resumable execution state.

These faults explain the observed repeated questions, repeated prompt, empty plan preview, invented scope, and stalled progress.

## 3. Product Principles

### 3.1 The approved specification is the source of truth

Chat is an input and explanation surface. It is not the build contract. A versioned `WorkspaceSpec` is the only object allowed to drive implementation.

### 3.2 State transitions are deterministic

The application decides whether a workspace is clarifying, ready for review, approved, building, verifying, blocked, or delivered. Models propose content inside a stage; they do not invent stage transitions.

### 3.3 Autonomy is bounded by risk

Safe reads, planning, local workspace edits, and tests can proceed automatically within an approved scope. External, destructive, privileged, secret-bearing, or production operations require the applicable policy or human approval.

### 3.4 Evidence precedes completion

No task, stage, or project is complete because a model says it is complete. Completion requires recorded command output, tests, application behavior, screenshots where applicable, and specification traceability.

### 3.5 Internal architecture remains confidential

The user sees one visible identity: **Planner**. Parallel or delegated work is presented only through generic terms such as `Subtask`, `Workspace`, `Quality check`, and `Verification`.

### 3.6 The system asks only consequential questions

Questions are asked only when the answer materially changes scope, data handling, security, cost, design, integration, or delivery. Answered questions cannot be asked again unless the user explicitly revises the answer or a contradiction is detected.

## 4. Durable Workspace Model

Every project is a workspace with persistent state.

```typescript
type WorkspacePhase =
  | "intake"
  | "clarifying"
  | "plan_ready"
  | "approved"
  | "building"
  | "verifying"
  | "blocked"
  | "delivered"
  | "cancelled";

interface WorkspaceSpec {
  workspaceId: string;
  version: number;
  hash: string;
  status: "draft" | "approved" | "superseded";
  originalRequest: string;
  confirmedFacts: ConfirmedFact[];
  questions: RequirementQuestion[];
  assumptions: Assumption[];
  scope: ScopeItem[];
  userJourneys: UserJourney[];
  pages: PageSpec[];
  dataModel: EntitySpec[];
  apiContracts: ApiContract[];
  auth: AuthSpec;
  design: DesignDirection;
  sources: SourceReference[];
  acceptanceCriteria: AcceptanceCriterion[];
  approvedAt?: string;
  approvedBy?: string;
}
```

Each fact, assumption, question, page, feature, API, and entity has a stable ID. Scope items have an explicit state:

- `confirmed`
- `suggested`
- `deferred`
- `rejected`

Only `confirmed` items may enter the implementation DAG. Suggestions remain visible but cannot silently become deliverables.

### 4.1 Versioning and approval

- Each material edit creates a new immutable specification version and hash.
- `Accept` approves the exact displayed version and hash.
- `Revise` creates a new draft; it never mutates the approved version.
- Build runs store the approved specification hash they execute.
- A build fails closed if its specification hash is missing, superseded, or does not match the approved record.

### 4.2 Idempotency

Every chat message, plan action, stage transition, tool request, and build start carries an idempotency key. Replays return the existing result instead of creating duplicate messages or workflows.

## 5. Planning and Clarification Engine

### 5.1 Intake

The intake layer extracts candidate facts from imperfect natural language without silently treating corrections as truth. For example, it may propose that `digatil ecomnay` means `digital economy`, but records the correction as an assumption until confirmed or safely inferable from context.

### 5.2 Requirement ledger

The planner reads and writes a structured requirement ledger rather than relying on the conversation transcript alone. Each question records:

- why the answer matters;
- the available choices;
- the recommended choice and rationale;
- the user's answer;
- whether the answer resolved the uncertainty;
- the specification fields affected.

### 5.3 Question policy

- Ask one concise question at a time.
- Prefer 2-3 mutually exclusive choices and a free-form option.
- Do not ask about information discoverable from the workspace or supplied sources.
- Do not re-ask resolved questions.
- Do not block the plan on non-material details; record a clearly marked reversible assumption.
- Detect contradictions and ask one focused reconciliation question.

### 5.4 Plan generation

The plan is generated from the ledger and includes:

- product objective and target users;
- confirmed scope and explicit non-scope;
- routes and user journeys;
- backend endpoints and data entities;
- authentication purpose and roles, if confirmed;
- design direction;
- sources and integrations;
- delivery approach;
- implementation phases and dependency DAG;
- security and privacy constraints;
- acceptance tests.

The plan must not propose a framework, deployment platform, dashboard, admin panel, payment system, notification channel, or integration as confirmed scope unless the requirement ledger supports it.

## 6. Plan-to-Build Contract

The current prose reconstruction path is removed.

```text
WorkspaceSpec vN (approved hash)
  -> contract validation
  -> dependency DAG
  -> bounded implementation tasks
  -> generated artifacts tagged with requirement IDs
  -> verification against the same WorkspaceSpec vN
```

There is no `"build it"` message in this path. The Accept action calls an authenticated approval endpoint with the specification ID, version, hash, and idempotency key. The workflow receives that immutable object directly.

Every implementation artifact stores traceability metadata linking it to one or more specification requirements. Verification uses those links to detect missing, invented, or partially implemented scope.

## 7. Autonomous IDE Experience

The desktop layout uses four coordinated surfaces.

### 7.1 Workspace Rail

- Projects and recent workspaces
- Current phase and health
- Sources and attachments
- Delivered builds
- Search and resume

### 7.2 Command Canvas

- Conversation with the visible Planner
- One-question clarification cards
- Plan approval and revision cards
- Chronological execution ledger
- User steering and interruption

Large user messages use a restrained neutral surface, not full-saturation blocks. Important decisions, warnings, and approvals receive the accent color.

### 7.3 Evidence Deck

Persistent tabs:

1. Requirements
2. Plan
3. Files
4. Preview
5. Tests
6. Delivery

The deck survives refresh and reconnect. It shows real stored state, not client-only placeholders.

### 7.4 Execution Drawer

- Terminal and process output
- Running and completed subtasks
- Permission requests
- Tool activity
- Error and repair history

Commands, environment variables, headers, tokens, and file content pass through centralized redaction before reaching the browser.

### 7.5 Visual direction

The initial product identity uses deep neutral black, warm gold, off-white text, restrained success/error colors, strong typographic hierarchy, and accessible contrast. It avoids oversized colored chat bubbles, template card grids, generic gradients, and decorative activity that is not backed by runtime state.

The design must be responsive, keyboard navigable, screen-reader usable, and usable at 375 px, 768 px, 1280 px, and large desktop widths.

## 8. Public Activity Event Boundary

Internal runtime events must never stream directly to the browser.

```typescript
interface PublicActivityEvent {
  id: string;
  workspaceId: string;
  runId: string;
  category:
    | "planning"
    | "subtask"
    | "file"
    | "command"
    | "test"
    | "preview"
    | "repair"
    | "approval"
    | "delivery";
  status: "queued" | "running" | "passed" | "failed" | "blocked";
  summary: string;
  safePath?: string;
  elapsedMs?: number;
  evidenceId?: string;
  createdAt: string;
}
```

A server-side translator converts internal events into this schema and removes:

- internal identities and counts;
- model/provider names and routing;
- system prompts and hidden reasoning;
- secret values and sensitive headers;
- unrestricted command strings;
- absolute host paths outside the workspace;
- stack traces not safe or useful to the user.

## 9. Sources and Artifacts

### 9.1 Supported sources

- Plain text and Markdown
- Source-code files and repositories
- PDF
- Word documents
- Images and screenshots
- Structured data
- URLs and API endpoints

### 9.2 Ingestion pipeline

```text
upload/fetch
  -> authorization and workspace ownership
  -> filename normalization
  -> size and type validation
  -> malware/content safety checks
  -> content-addressed storage
  -> extraction/OCR/vision
  -> chunking and indexing
  -> source citations
```

URL and API inspection requires SSRF protection, protocol restrictions, DNS/IP validation, redirect limits, response-size limits, timeouts, and an egress policy.

The Planner and implementation tasks receive extracted, cited content. A binary filename placeholder is not considered successful ingestion.

### 9.3 Artifact model

Plans, files, screenshots, test reports, documents, previews, and delivery packages are durable artifacts with ownership, provenance, integrity hash, MIME type, and access policy.

## 10. Tool and Permission Model

Tool actions are classified by risk:

| Risk | Examples | Default behavior |
|---|---|---|
| Read | Read workspace file, inspect logs, query indexed source | Automatic inside authorized workspace |
| Draft | Create plan, generate preview, write sandbox artifact | Automatic and logged |
| Write | Modify approved workspace files, apply development migration | Automatic only inside approved scope and sandbox |
| External | Fetch URL, call external API, send notification | Policy-controlled, rate-limited, visible |
| Destructive | Delete data, force rollback, overwrite outside safe recovery | Human approval |
| Privileged | Production credentials, production database, secret rotation | Human approval only |

Permissions are checked server-side for every action. UI controls are not a security boundary.

Secrets are stored as encrypted credential records. Tools receive short-lived scoped references. Browser events show only secret names and safe metadata, never values.

## 11. Security Requirements

The following are release blockers:

1. Every workspace, chat session, plan, artifact, attachment, event stream, and preview requires authenticated ownership or explicit authorized sharing.
2. Project identifiers are not authorization credentials.
3. WebSocket/SSE connections use short-lived, workspace-scoped authorization.
4. Raw internal logs are never sent to the public client.
5. Upload filenames cannot control storage paths.
6. Upload size, type, content, and ownership are validated before processing.
7. Tool paths are canonicalized and constrained to the active workspace/sandbox.
8. External HTTP tools block private-network and metadata endpoints unless explicitly authorized for local testing.
9. Sensitive data is redacted before storage and again before presentation.
10. Authorization, isolation, traversal, SSRF, injection, and secret-leakage tests are mandatory.

The existing public artifact and raw event-stream behavior must not be exposed on a live server until these controls pass.

## 12. Execution, Verification, and Self-Repair

### 12.1 Execution

Approved requirements are decomposed into bounded tasks with dependencies, required tools, expected artifacts, and acceptance tests. Independent safe work may execute concurrently. Conflicting writes are serialized or isolated.

### 12.2 Verification loop

```text
implement
  -> run targeted test
  -> observe real output
  -> if failure: diagnose root cause
  -> apply bounded repair
  -> rerun exact failing test
  -> run affected suite
  -> run full required regression
  -> verify live user journey
```

Failures generate evidence. Repair tasks receive the failing command, sanitized output, affected requirement IDs, relevant files, and last verified checkpoint. They do not receive an unconstrained instruction to regenerate the whole project.

### 12.3 Stuck detection

The system records repair signatures and outcome changes. Repeated equivalent failures without material improvement move the workspace to `blocked` and ask the user one precise question or request one necessary permission. It does not display endless thinking or silently restart.

### 12.4 Delivery gate

Delivery requires:

- approved specification hash matches the build run;
- all confirmed requirements are traced to artifacts;
- no rejected/deferred feature is presented as delivered;
- required tests pass;
- live preview journey passes;
- security release blockers pass;
- source and delivery documentation exist;
- user-facing event payloads pass confidentiality checks.

## 13. Resilience and Recovery

- Workspace state persists in the database, not browser-only state.
- Event streams are resumable from a durable sequence cursor.
- Every stage writes a checkpoint with inputs, outputs, hashes, and evidence references.
- A page refresh reconnects to the existing workspace and run.
- Server restart resumes from the last verified checkpoint.
- Duplicate requests are absorbed by idempotency records.
- Cancellation is explicit and does not masquerade as failure.
- Rollback restores the last verified state without deleting audit evidence.

## 14. Multi-Dimensional Definition of Done

NexSidi is not described as competitive with leading coding IDE agents until it passes an evidence-backed benchmark covering all of the following:

1. Requirement understanding and typo recovery
2. Clarification quality and non-repetition
3. Planning completeness and editability
4. Approved-plan/build fidelity
5. Reasoning and decomposition quality
6. Long-session context and resume behavior
7. Tool breadth and correctness
8. Safe autonomous execution
9. Failure diagnosis and self-repair
10. Security and workspace isolation
11. User-visible transparency and confidentiality
12. End-to-end verified delivery

The initial benchmark suite includes at least 100 varied project requests and explicit regression cases for:

- duplicate prompt and response races;
- refresh during clarification, approval, build, and verification;
- contradictory and revised answers;
- malformed and adversarial uploads;
- unauthorized cross-workspace access;
- log and secret leakage;
- PDF, Word, image, screenshot, URL, and API sources;
- deliberately injected compile, runtime, API, database, and UI failures;
- scope invention and missing confirmed scope;
- responsive and accessible user journeys.

Required release outcomes include zero critical approved-plan/build mismatches, zero unauthorized cross-workspace access, and zero confidential internal identity or secret leakage in public payloads.

## 15. Implementation Sequence

### Phase 1 - Reliability and security foundation

- Add failing regression tests for duplicate message races.
- Introduce durable workspace, message, requirement, plan, approval, and event records.
- Add idempotent chat and build transitions.
- Protect workspace, artifact, attachment, plan, preview, and event routes.
- Introduce centralized public-event translation and redaction.

### Phase 2 - Planner and plan-to-build contract

- Implement the requirement ledger and deterministic state machine.
- Persist question answers and assumptions.
- Generate versioned specifications.
- Implement Accept/Revise against an exact version/hash.
- Feed the approved specification directly into decomposition and verification.
- Remove unconditional scope from generator contracts.

### Phase 3 - Autonomous IDE shell

- Build the Workspace Rail, Command Canvas, Evidence Deck, and Execution Drawer.
- Replace client-only plan state with workspace queries and resumable events.
- Implement accessible question, approval, activity, file, preview, test, and delivery views.
- Apply the deep-neutral/warm-gold design system responsively.

### Phase 4 - Source and artifact intelligence

- Secure upload/fetch pipeline.
- Extract and cite PDF, Word, Markdown, code, image, screenshot, URL, and API content.
- Add durable artifact provenance, integrity, and ownership.
- Add safe credential references and permission UI.

### Phase 5 - Execution, browser testing, and self-repair

- Execute the approved DAG with generic user-visible subtask events.
- Capture file and command evidence.
- Start and inspect live previews.
- Run browser journeys and screenshots.
- Implement targeted repair, full regression, stuck detection, and resume.

### Phase 6 - Competitive benchmark and production gate

- Run the multi-dimensional benchmark suite.
- Perform complete application security validation.
- Measure reliability, latency, resource use, and user-journey success.
- Fix benchmark failures and repeat complete affected evaluations.
- Enable production exposure only after all release blockers pass.

## 16. Non-Goals for the First Implementation Slice

- Copying another IDE's layout or visual assets
- Public exposure of internal identities or architecture
- Unrestricted autonomous production access
- Replacing every existing runtime component before establishing the durable contract
- Adding unrelated application features to generated projects
- Claiming competitive parity before benchmark evidence exists

## 17. First Slice Exit Criteria

The first implementation slice comprises Phase 1 and the contract-critical portion of Phase 2. It is complete only when the Nextech reproduction scenario proves:

1. The initial requirement is stored and displayed exactly once.
2. Each assistant response is stored and displayed exactly once.
3. Answered questions remain answered after refresh and reconnect.
4. The right-side plan appears from durable server state.
5. Accept approves a specific specification version and hash.
6. The build run consumes that exact approved object.
7. Unapproved dashboard/admin/product scope is not added.
8. Unauthorized users cannot read another workspace's chat, plan, artifacts, files, or events.
9. Public events contain no internal identities, raw prompts, model routing, or secret values.
10. Regression, authorization, and confidentiality tests pass with recorded evidence.

Only after this slice is proven should the full IDE shell replace the current planning page.
