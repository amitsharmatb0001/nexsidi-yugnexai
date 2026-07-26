# CLAUDE.md — NexSidi Master Context
## Read this completely before doing anything else.

---

## ⚡ FIRST THING YOU DO — EVERY SESSION

```
1. READ this entire file
2. READ PROGRESS.md (current sprint state)
3. FORM your own build plan based on what you understand
4. PRESENT the plan to Amit for approval
5. WAIT for explicit approval
6. ONLY THEN begin work — not before
```

**Never assume. Never start. Present the plan first. Always.**

If this is a new session with no PROGRESS.md yet — form a plan for
Phase 0 (skeleton) and present it. Wait for approval.

Use your skills. They are installed in Claude Desktop. The key ones
for building NexSidi:
```
nexsidi-master-workflow    ← read at the start of every session
nexsidi-preflight          ← before every new project build
nexsidi-brainstorm         ← before any new feature
nexsidi-planning           ← Arjun's task decomposition
nexsidi-testing            ← write tests BEFORE implementation
nexsidi-verification       ← before claiming anything is done
nexsidi-debugging          ← before proposing any fix
nexsidi-git-workflow       ← for parallel agent worktrees
nexsidi-context-chain      ← every inter-agent transfer
nexsidi-bun-hono           ← Shubham's API layer
nexsidi-generated-stack    ← what Aanya/Shubham/Pranav build for users
nexsidi-database           ← Pranav's migrations
nexsidi-adversarial-qa     ← Navya/Karan/Deepika QA gate
nexsidi-pr-automation      ← Karan's CI review
nexsidi-receiving-feedback ← when QA flags issues
nexsidi-security           ← 8-layer security model
nexsidi-llm-client         ← NVIDIA NIM + Ollama routing
nexsidi-temporal           ← Temporal workflow orchestration
nexsidi-unattended-loop    ← outer session loop
nexsidi-subagent-dev       ← preferred execution mode (D41)
nexsidi-parallel-agents    ← Shubham/Aanya/Pranav parallel dispatch
nexsidi-multi-agent        ← agent Kanban and coordination
```

---

## WHAT NEXSIDI IS

NexSidi is not a code generator. It is an **autonomous software
business operator** that owns a software product's entire lifecycle:

```
PRE-PRODUCTION  → PRODUCTION        → POST-PRODUCTION  → BUSINESS OPS
Requirements       Parallel dev        Monitoring          Social media
Spec locking       Adversarial QA      Security patching   Investor relations
Architecture       Live testing        Feature updates     Financial modeling
Design system      Cryptographic chain Performance opt     Legal compliance
Task decomposition Sandbox isolation   CVE response
```

Code generation is ~20% of the system. The other 80% — the part
nobody else has built — differentiates NexSidi from Lovable, Bolt,
Replit, Devin, and Claude Code.

**Company:** YugNex Technology (OPC) Private Limited
**Patent:** Indian #202611001020, 10 claims, filed Jan 5 2026
**PCT deadline:** January 4 2027 — CRITICAL, attorney not yet engaged
**Raise:** $1.0M / ₹9.45Cr for 15%, pre-money $5.67M

---

## 10 PATENT CLAIMS

| Claim | What it protects |
|---|---|
| 1 | SHA-256 hash chain on every inter-agent context transfer |
| 2 | Persistent instinct memory with confidence-scoring |
| 3 | Automatic rollback to last verified state on hash mismatch |
| 4 | GAN-style adversarial QA — error-maximizing independent evaluator |
| 5 | 4-tier kernel isolation sandbox |
| 6 | DAG-based parallel task decomposition |
| 7 | Cryptographic RSA-SHA256 signing of every agent output |
| 8 | OTP/PIN-based user approval before code execution |
| 9 | Hierarchical Chief AI Officer coordination pattern |
| 10 | 100% full retest after EVERY adversarial finding |

---

## CONFIDENTIALITY RULE — NO EXCEPTIONS

Agent names, agent count, and internal architecture **never** appear in:
- Any user-facing interface or message
- Investor decks, websites, public documentation
- Any external communication without a signed NDA

External description only: "a coordinated multi-agent system"
Never: "38 agents" or any agent name (Tilotma, Shubham, etc.)

---

## THE 38-AGENT ROSTER (internal only)

### Core Pipeline
| Agent | Role | Model |
|---|---|---|
| **Tilotma** | Chief AI Officer — highest rank, all critical decisions | DeepSeek V4-Pro |
| **Saanvi** | Requirements → locked ProjectSpec JSON | MiniMax M3 |
| **Arjun** | Pipeline lead, task decomposition, parallel dispatch | Mistral-Nemotron |

### Web Development — Phase 1 (ACTIVE — BUILD THESE FIRST)
| Agent | Role | Model |
|---|---|---|
| **Vanya** | UI/UX design, queries design databases | Qwen2.5-Coder 7B |
| **Aanya** | Frontend — Next.js 16.2, TypeScript, Tailwind, shadcn/ui | DeepSeek V4-Pro |
| **Shubham** | Backend — TypeScript, Bun, Hono | DeepSeek V4-Pro |
| **Pranav** | Database — PostgreSQL 16, Drizzle ORM, migrations | Qwen2.5-Coder 7B |
| **Aarav** | Test runner — TDD, writes tests BEFORE implementation | Qwen2.5-Coder 7B |
| **Riya** | DevOps — Docker Compose, local deployment | Qwen2.5-Coder 7B |

### Adversarial QA (auto-run, never user-visible)
| Agent | Attack type | Model |
|---|---|---|
| **Navya** | Logic — null refs, algorithm flaws, race conditions | Kimi K2.6 |
| **Karan** | Security — OWASP, exploit payloads against live app | Kimi K2.6 |
| **Deepika** | Performance — N+1, memory leaks, response times | MiniMax M3 |

Why 3 different models for parallel agents: all 3 run simultaneously.
Same model = 40 RPM rate limit collision. Different models = 120 RPM
effective capacity. Kimi K2.6 for Navya/Karan — reads Chinese-language
code review reference files natively.

### Mobile/Desktop/System — Phase 2
Kabir (React Native), Sayan (App Stores), Dhruv (Tauri),
Aryan (desktop DevOps), Ishaan (Go/Rust tools).

### Post-Production — Phase 2
Ishan (maintenance), Naina (feature additions), Sid (performance).

### Knowledge System — Phase 2
**Neha** — monitors GitHub releases, npm versions, CVE feeds every 6
hours. When Next.js 17 ships, Neha updates the skill. Agents query
Neha's live knowledge DB, not their training weights, for versions.

### Red Team — TOP SECRET
| Agent | Specialty |
|---|---|
| Vikram | Infrastructure attack — IAM, containers, cloud |
| Priya | Application attack — OWASP against NexSidi's OWN APIs |
| Raj | Prompt injection — malicious inputs, indirect injection |
| Surya | Supply chain — dependency confusion, malicious packages |

### Blue Team — TOP SECRET
| Agent | Specialty |
|---|---|
| Ananya | SOC monitoring — all logs 24/7, anomaly detection |
| Kunal | Incident response — contain, preserve, recover |
| Divya | Threat intelligence — CVE feeds, IOC tracking |
| Rohan | Defensive hardening — WAF, rate limits, infra |

Red/Blue ≠ Adversarial QA:
- Adversarial QA (Navya/Karan/Deepika) = attacks GENERATED CODE before delivery
- Red Team = attacks NEXSIDI'S OWN PLATFORM infrastructure
- Blue Team = defends and monitors NEXSIDI'S OWN PLATFORM 24/7

### Operations
Social media: Prerna, Neel, Tanya, Aman, Mihir.
Docs: Kavya, Ria, Dev, Pooja. Business: Manan (CFO), Shriya, Radhika.

---

## TECH STACK — DECIDED, DO NOT RELITIGATE

### NexSidi's Own Platform
```
API:           TypeScript + Bun + Hono (port 8080)
Frontend:      Next.js 16.2 + TypeScript + @yugnex/nexui + @yugnex/nexui-react
               ⚠️  NOT Next.js 14 — it is EOL since October 2025
               ⚠️  NOT Next.js 15 — 16 is current stable (June 2026)
Database:      PostgreSQL 16 + Drizzle ORM + pgvector
Cache:         Redis
Orchestration: Temporal (local: Docker, production: Temporal Cloud)
Sandbox:       Rust (4-tier isolation, Patent Claim 5) for generated code
               bubblewrap/seatbelt for NexSidi's own agent tool calls
LLM SDK:       @anthropic-ai/claude-agent-sdk (NOT raw @anthropic-ai/sdk)
               Handles automatic compaction — no context resets needed
               with Opus-tier models (they don't exhibit context anxiety)
```

### Generated User Apps
```
Frontend:  Next.js 16.2 + TypeScript + @yugnex/nexui-react (vendored into the
           generated app's own output dir — no external npm dependency)
           NOT Tailwind, NOT shadcn/ui, NOT @radix-ui
Backend:   Node.js + Express + TypeScript
Database:  PostgreSQL 16 (local Docker container)
Auth:      Custom JWT (jsonwebtoken + bcryptjs) — NOT Clerk
Deploy:    Docker Compose → localhost (local delivery to user)
           NOT Vercel, NOT Railway, NOT Supabase — local only for now
```
2026-07-25 (P4): corrected to match the actual Shubham/Aanya generator code
(agents/generators/{shubham,aanya}/src/index.ts, packages/agent-runtime/skills/
{shubham,aanya}.md) — both were already built around this stack; this section
had never been updated to match and still said Tailwind+shadcn/ui+Clerk,
found live while approving the NexTech build's spec-approval gate. NexUI is
now used for BOTH NexSidi's own platform and every generated app — no longer
"deliberately different" on the UI library, only on backend framework
(Bun+Hono vs Express) and the reasoning in "Why Different Stacks" below still
applies to that split.

One `docker-compose.yml` per project. User gets the file + source code.
They run `docker-compose up` and open `http://localhost:3000`.

### Why Different Stacks
Generated code must be maintainable by any developer the user hires.
Express is universally known. Bun+Hono is cutting-edge. Different by design.

### LLM Routing
```
NVIDIA NIM (free dev tier — nim.nvidia.com):
  deepseek-v4-pro  → Tilotma, Aanya, Shubham (40 RPM limit per model)
  minimax-m3       → Saanvi, Deepika
  mistral-nemotron → Arjun
  kimi-k2-6        → Navya, Karan

Local Ollama (Qwen2.5-Coder 7B Q4_K_M — GPU on Dell G15):
  Vanya, Pranav, Aarav, Riya
  Ollama runs NATIVELY on Windows — NOT in Docker
  Docker containers reach it: http://host.docker.internal:11434
```

---

## LOCAL DEVELOPMENT ENVIRONMENT

```
Machine: Dell G15 5530, Windows 11
Docker:  PostgreSQL 16, Redis, Temporal (containers)
Ollama:  Native Windows — direct GPU access
         Model: qwen2.5-coder:7b (run: ollama run qwen2.5-coder:7b)
API:     bun run dev → localhost:8080
Web:     next dev → localhost:3000
Temporal UI: localhost:8088

Generated apps:
  docker-compose up → localhost:3000 (user's app)
  Fresh container per test run, destroyed after
```

---

## REPOSITORY STRUCTURE

```
nexsidi/
├── CLAUDE.md                    ← YOU ARE HERE
├── PROGRESS.md                  ← Sprint tracker (read every session)
├── package.json                 ← Bun workspace root
├── .env.example
│
├── apps/
│   ├── api/                     ← Shubham: TypeScript + Bun + Hono
│   │   ├── src/
│   │   │   ├── index.ts         ← entry, port 8080
│   │   │   ├── app.ts           ← Hono app + middleware
│   │   │   ├── routes/
│   │   │   ├── middleware/      ← auth (Clerk JWT), rate limit, sanitization
│   │   │   └── db/              ← Drizzle client
│   │   └── tests/
│   │
│   └── web/                     ← Aanya: Next.js 16.2 + shadcn/ui
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx         ← onboarding/landing
│       │   ├── dashboard/       ← user's projects
│       │   └── build/[id]/      ← live pipeline status
│       ├── components/
│       │   ├── ui/              ← shadcn/ui components
│       │   └── pipeline/        ← status panels
│       └── next.config.ts       ← TypeScript config (Next.js 16 style)
│
├── packages/
│   ├── context-chain/           ← Patent Claims 1/3/7
│   │   ├── hash.ts              ← SHA-256 canonicalize + hash
│   │   ├── sign.ts              ← RSA-SHA256 signing
│   │   └── verify.ts            ← verification + rollback trigger
│   ├── llm-client/              ← Shared across all agents
│   │   ├── nim.ts               ← NVIDIA NIM client
│   │   ├── ollama.ts            ← local Ollama client
│   │   └── router.ts            ← per-agent model assignment + fallback
│   └── db/                      ← Shared schema
│       ├── schema.ts
│       ├── client.ts
│       └── migrations/
│
├── agents/                      ← All agent implementations
│   ├── tilotma/                 ← Orchestrator (Chief AI Officer)
│   ├── saanvi/                  ← Requirements → ProjectSpec JSON
│   ├── arjun/                   ← Planner → task decomposition
│   ├── generators/
│   │   ├── shubham/             ← Express backend generator
│   │   ├── aanya/               ← Next.js 16 frontend generator
│   │   └── pranav/              ← Drizzle migrations generator
│   ├── qa/
│   │   ├── navya/               ← Adversarial logic QA
│   │   ├── karan/               ← Adversarial security QA
│   │   └── deepika/             ← Adversarial performance QA
│   └── riya/                    ← Docker Compose + local deploy
│
├── pipeline/                    ← Temporal workflows
│   ├── workflows/
│   │   └── project-build.ts     ← main pipeline
│   └── activities/              ← one file per pipeline stage
│
├── sandbox/                     ← Rust: Patent Claim 5
│   ├── src/main.rs
│   └── Cargo.toml
│
├── docs/
│   ├── AGENTS.md                ← Full roster with model assignments
│   ├── PIPELINE.md              ← Pipeline flow diagrams
│   ├── DECISIONS.md             ← D1-D50 full
│   └── specs/                   ← ProjectSpec JSON files
│
├── .github/
│   └── workflows/
│       ├── karan-review.yml     ← claude-code-action PR gate
│       └── ci.yml               ← build + test
│
├── .nexsidi/
│   └── sdd/
│       └── progress.md          ← Subagent dev progress ledger
│
├── .worktrees/                  ← Parallel agent workspaces (git-ignored)
└── docker-compose.dev.yml       ← Temporal + PostgreSQL local
```

---

## THE PIPELINE FLOW

```
User request
    ↓
Tilotma receives + validates (Layer 1: injection check)
    ↓
Saanvi: requirement gathering → ProjectSpec JSON → user approval
    ↓
Arjun: spec → API contract + DB schema + task decomposition
       Independence check → if clean → parallel dispatch
    ↓ (parallel — 3 git worktrees)
Shubham: Express backend    ─┐
Aanya:   Next.js frontend   ─┤  different models, different worktrees
Pranav:  DB migrations      ─┘  context chain on all transfers
    ↓ (merge)
Stage 0: Arjun spec-compliance check (cheap, fast)
    ↓
Stage 1: Navya + Karan + Deepika static review (parallel, different models)
         Pass threshold: ≥ 85/100 (100 - critical×20 - high×10 - medium×5)
    ↓
Stage 2: Live app testing (Playwright, only when static is clean)
         Pass threshold: ≥ 7.0/10 (design×0.35 + originality×0.35 + craft×0.15 + func×0.15)
    ↓
Riya: generate docker-compose.yml → docker-compose up → localhost:3000
    ↓
Tilotma delivers to user:
  ✓ http://localhost:3000 (working app)
  ✓ GitHub repo
  ✓ PRD document
  ✓ Feature list (plain language)
  ✗ Agent names, architecture, QA scores, iteration count (never)
```

---

## ADVERSARIAL QA — TWO SCORING SYSTEMS (not one)

### System A: Objective bug scoring (Navya/Karan/Deepika)
```
Score = 100 − (CRITICAL×20) − (HIGH×10) − (MEDIUM×5) − (LOW×1)
Pass: ≥ 85
Severity: 🔴 blocking / 🟡 should fix / 🟢 optional / 💡 suggestion
```

### System B: Subjective quality scoring (live app)
```typescript
const LIVE_EVAL_CRITERIA = {
  designQuality: {
    weight: 0.35,
    verbatim: "Does the design feel like a coherent whole rather than a " +
      "collection of parts? Strong work means colors, typography, layout, " +
      "imagery, and other details combine to create a distinct mood and identity."
  },
  originality: {
    weight: 0.35,
    verbatim: "Is there evidence of custom decisions, or is this template " +
      "layouts, library defaults, and AI-generated patterns? Unmodified stock " +
      "components—or telltale signs of AI generation like purple gradients " +
      "over white cards—fail here."
  },
  craft: {
    weight: 0.15,
    verbatim: "Technical execution: typography hierarchy, spacing consistency, " +
      "color harmony, contrast ratios. A competence check not a creativity check."
  },
  functionality: {
    weight: 0.15,
    verbatim: "Can users understand what the interface does, find primary " +
      "actions, and complete tasks without guessing?"
  }
};
// Pass: ≥ 7.0 weighted average
// Design + Originality weighted 0.35 each — Claude passes Craft/Func by default
// These weights push away from "AI slop" (purple gradients, template layouts)
```

### Loop control
```
Stuck detection: no ≥3-point improvement across 3 consecutive iterations
→ escalate to Tilotma
→ Tilotma: ONE specific question to user with concrete options
→ Never: "there were bugs" or "something went wrong"

2-3 iterations is NORMAL. Only stuck-state triggers escalation.
```

---

## CONTEXT CHAIN (Patent Claims 1/3/7)

```typescript
// Every inter-agent transfer:
const hash = createHash('sha256').update(canonicalize(context)).digest('hex');
const signature = createSign('RSA-SHA256').update(JSON.stringify(output)).sign(privateKey, 'hex');

// Receiving agent verifies BOTH before using context:
// 1. Verify RSA signature → fail: rollbackToLastGoodState()
// 2. Verify hash → fail: rollbackToLastGoodState()
// 3. Mark verified in context_chain table
// 4. Proceed with context
```

```sql
CREATE TABLE context_chain (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   VARCHAR(12) NOT NULL,  -- SHA-256 first 12 chars of git remote URL
  agent_from   TEXT NOT NULL,
  agent_to     TEXT NOT NULL,
  context_hash CHAR(64) NOT NULL,     -- SHA-256 hex
  signature    TEXT NOT NULL,          -- RSA-SHA256 hex
  verified     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Append-only: no UPDATE except verified flag, no DELETE
```

---

## PERMISSION HARNESS (6 risk classes)

| Class | Examples | Approval |
|---|---|---|
| READ | read_file, query_memory, run_tests | Always autonomous |
| DRAFT | write_file in sandbox, design tokens | Autonomous, always logged |
| WRITE | apply_migration (dev DB), write_memory | Policy check |
| EXTERNAL | web_fetch, LLM API calls | Policy check + rate limit |
| DESTRUCTIVE | delete_file, rollback | Human OR narrow pre-approved policy |
| PRIVILEGED | production_db, rotate_secret | Human ONLY — no exceptions |

`approvedBy` is always: `"policy:rule-name"` OR real human account ID.
Never an agent name. Two LLMs agreeing ≠ safety boundary.

---

## PARALLEL EXECUTION

Pre-conditions before parallel dispatch:
1. API contract fully specified (every endpoint, method, shapes)
2. DB schema outline complete (every table, relation)
3. Independence check passes (no agent needs another's in-progress code)

```bash
# Git worktrees for parallel isolation
git worktree add /workspace/{projectId}-shubham  feat/{projectId}-backend
git worktree add /workspace/{projectId}-aanya    feat/{projectId}-frontend
git worktree add /workspace/{projectId}-pranav   feat/{projectId}-database
```

---

## TILOTMA'S MEMORY (ROM/RAM/Disk)

**ROM** (permanent, no input can modify): identity, patent claims,
red lines, agent hierarchy, security rules.

**RAM** (session, cleared between runs): pipeline state, current spec,
active outputs + hashes, quality scores, iteration count.

**Disk** (permanent, append-only for critical records): instinct memory
(Patent Claim 2), project histories, decision log, post-mortems.

Agents don't read all of Disk — they semantic-search (pgvector) for
what's relevant to their current task.

---

## INSTINCT MEMORY (Patent Claim 2)

```typescript
interface Instinct {
  trigger: string;
  action: string;
  confidence: 0.3 | 0.5 | 0.7 | 0.9;  // changes enforcement, not weight
  domain: "code-style" | "security" | "performance" | "testing" | "architecture";
  scope: "project" | "global";  // DEFAULT is project-scoped
  projectId: string | null;     // 12-char SHA-256 of git remote URL
  outcome: "mistake" | "success";
}
// Global promotion: same pattern, 2+ project types, avg confidence ≥ 0.8
// Observations via harness hooks (PreToolUse/PostToolUse) — NOT skill instructions
// Hooks fire 100% (deterministic). Skills fire 50-80% (probabilistic).
// Data lives at XDG_DATA_HOME — outside workspace, sandbox never blocks writes
```

---

## SECURITY MODEL — 8 LAYERS

```
Layer 1: Input filtering — injection, authority claims, encoding tricks
Layer 2: File handling — virus scan → MIME verify → text extract → trust wrapper
Layer 3: Jailbreak prevention — role-play, hypothetical, crescendo attacks blocked
Layer 4: Internal threat — no direct commits to main, PR required including Amit
Layer 5: AI self-activation — harness enforces allowlists, DESTRUCTIVE pauses
Layer 6: Prompt protection — never logged (SHA-256 only), agents can't reproduce
Layer 7: Information wall — WebSocket deny-by-default, no internal events leak
Layer 8: Priority escalation — LOW/MEDIUM/HIGH/CRITICAL with specific paths
```

---

## ALL ARCHITECTURAL DECISIONS (D1-D50)

**Stack:** D1=Bun+Hono (not Rust+Axum), D2=generated apps use Express (not Bun),
D3=two-tier sandbox, D4=NVIDIA NIM + Ollama routing, D5=single Postgres with
user_id columns (not per-user schemas), D6=one GitHub repo per project,
D7=no raw SQL through agent harness, D8=expand-contract migrations only.

**Agents:** D9=Tilotma is Chief AI Officer, D10=two pipeline modes (user_project
vs internal_dev), D11=Red/Blue auto-runs after every deploy,
D12=hierarchical+evaluator-optimizer topology, D13=context budget compounding
(4 mitigations: summarization, structured state, external memory, checkpointing),
D14=4-tier fallback chain per agent, D15=circuit breaker (CLOSED/OPEN/HALF-OPEN),
D16=3 HITL types (blocking/advisory/sampling).

**QA:** D17=≥20 test cases per agent before prompt changes, D18=two scoring
systems (objective ≥85 / subjective ≥7.0), D19=stuck-state not iteration cap,
D20=eval mode by project type (Playwright/screenshot/code-only),
D21=Stage 0 spec-compliance runs first (cheap gate), D22=planner is ambitious
(not minimal), D23=sprint contracts negotiated via files before code starts,
D24=evaluator only critiques (never suggests fixes), D25=default-FAIL contract,
D26=fresh-context evaluator (no Write tools, no generation history),
D27=re-simplify harness after every model upgrade.

**Memory:** D28=hooks not skill instructions for observations,
D29=project-scoped default with global promotion threshold,
D30=12-char project hash from SHA-256 of git remote URL,
D31=confidence tiers change enforcement, D32=instinct data at XDG_DATA_HOME.

**Permissions:** D33=approvedBy is policy or human ID never agent name,
D34=DESTRUCTIVE/PRIVILEGED require human no exceptions.

**Skills:** D35=descriptions = triggering conditions only,
D36=general+NexSidi-specific never blended, D37=3-level progressive disclosure,
D38=iron law: no skill without failing test, D39=match form to failure,
D40=receiving-feedback is critical gap (built — nexsidi-receiving-feedback),
D41=subagent-dev preferred over executing-plans when subagents available.

**Code review:** D42=real severity 🔴/🟡/🟢/💡/📚/🎉 (not CRITICAL/HIGH/MEDIUM/LOW),
D43=Kimi reads Chinese refs natively, D44=reuse check in Phase 3,
D45=formatters handle style (agents do NOT flag formatting).

**Performance:** D46=P95 <200ms, LCP <2.5s, uptime >99.9%.

**Business:** D47=quality over speed, D48=pricing deferred, D49=Series A
conversation at month 9-10, D50=rebuild from verified sources (this session).

---

## SPRINT 1 — NEXTECH COMPANY WEBSITE

⚠️ The Task Manager demo is RETIRED — it has been delivered 5-7 times already.
⚠️ DO NOT build a Task Manager again under any circumstances.

**Goal:** NexTech company website — a real business showcase that can be shown to
investors, clients, and partners.

**Input:** "Build a professional company website for NexTech — we provide mobile app
development, web app development, custom software, CRM, POS, bulk SMS, email
marketing, domain & hosting, and digital marketing services. Company name: NexTech.
Pages needed: Home, About Us, Vision, Mission, Services, Products, Contact.
Our vision is to make India a digital economy. Include a contact form and sign in/out."

**Active agents (Phase 1 only):**
Tilotma → Saanvi → Arjun → [Shubham + Aanya + Pranav parallel] → Navya/Karan/Deepika → Riya

**Deliverables:**
```
✓ http://localhost:3200 — opens in Chrome, works
✓ Home page — hero section, services overview, CTA
✓ Services page — all 9 services with descriptions
✓ About Us page — company story, team, values
✓ Vision & Mission pages
✓ Products page — software products NexTech offers
✓ Contact page — form with name, email, message, phone
✓ Sign in / Sign up — JWT auth
✓ Responsive design — looks great on mobile and desktop
✓ Professional, NOT AI-generated slop — real design identity
✓ docker-compose.yml — one command starts everything
```

**Generated app stack for this project:**
- Frontend: Next.js 16.2 + @yugnex/nexui-react → port 3200 (or next free port in 3200-3299)
- Backend: Express + TypeScript → port 3300 (or frontendPort+100)
- Database: PostgreSQL 16 container → port 5435 (or next free port)
- Auth: Custom JWT (no Clerk dependency)

**Design direction:**
Professional B2B tech company. Dark navy/midnight blue primary. Clean typography.
No purple gradients. No generic stock-photo hero. Real design decisions.

**Definition of done:**
All pages render. Contact form submits. Sign up/login works. Data persists.
Looks like a real company website, not an AI template.

---

## WHAT CLAUDE CODE MUST DO

```
⛔ NEVER start coding without Amit's approval of the plan
⛔ NEVER skip nexsidi-testing (write tests BEFORE implementation)
⛔ NEVER claim done without nexsidi-verification (run the command, show output)
⛔ NEVER use Next.js 14 or 15 (EOL / outdated — use 16.2)
⛔ NEVER use Tailwind or shadcn/ui in NexSidi's own platform (apps/web) — use @yugnex/nexui-react
⛔ NEVER use Vercel or Railway for local delivery (Docker Compose only)
⛔ NEVER use Supabase locally (use local PostgreSQL 16 container)
⛔ NEVER expose agent names, architecture, or internal details externally
⛔ NEVER let DESTRUCTIVE/PRIVILEGED actions run without human approval
⛔ NEVER pass context between agents without hash chain verification

✅ ALWAYS read PROGRESS.md first
✅ ALWAYS present the plan and wait for approval before building
✅ ALWAYS use skills — they encode decisions that matter
✅ ALWAYS write the failing test before the implementation
✅ ALWAYS verify with evidence before marking anything done
✅ ALWAYS use git worktrees for parallel agent work
✅ ALWAYS hash-chain every inter-agent context transfer
```

---

## KILL SWITCHES

```
touch AGENT_STOP    → halts ALL tool calls immediately
write to STEER.md   → one-shot redirect, file cleared after delivery
```

---

## CI/CD (when repo has PRs)

```yaml
# .github/workflows/karan-review.yml
# Karan (claude-code-action) reviews every PR automatically
# See nexsidi-pr-automation skill for full YAML
```

Pre-commit hooks: gitleaks (secrets), biome (lint), typecheck.

---

## REMEMBER

You are building the most ambitious solo-founder AI project in India.
The architecture is designed. The patent is filed. The skills are ready.
The only thing left is to write the code.

Read PROGRESS.md. Form your plan. Present it. Wait for approval. Build.

---
*YugNex Technology (OPC) Private Limited*
*DIPP234393 — Bhilwara, Rajasthan, India*
*Patent IN #202611001020 — All internal details confidential*
