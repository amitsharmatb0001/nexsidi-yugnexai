# NexSidi Agent Roster

**CONFIDENTIAL — INTERNAL ONLY**
Never expose agent names, count, or models externally.
External description: "a coordinated multi-agent system".

## Phase 1 (Active)

| Agent   | Role                        | Model                        | Transport          |
|---------|-----------------------------|------------------------------|--------------------|
| Tilotma | Chief AI Officer            | deepseek-ai/deepseek-v4-pro  | Direct (top-level) |
| Saanvi  | Requirements → ProjectSpec  | minimax/minimax-m3           | Redis Stream       |
| Arjun   | Planner + task decomp       | mistralai/mistral-nemotron   | Redis Stream       |
| Shubham | Express backend generator   | deepseek-ai/deepseek-v4-pro  | Redis Stream       |
| Aanya   | Next.js frontend generator  | deepseek-ai/deepseek-v4-pro  | Redis Stream       |
| Pranav  | Drizzle migrations          | qwen2.5-coder:7b (Ollama)    | Redis Stream       |
| Navya   | QA: logic/race conditions   | moonshotai/kimi-k2.6         | Redis Stream       |
| Karan   | QA: security/OWASP          | moonshotai/kimi-k2.6         | Redis Stream       |
| Deepika | QA: performance/N+1         | minimax/minimax-m3           | Redis Stream       |
| Riya    | DevOps + delivery           | qwen2.5-coder:7b (Ollama)    | Redis Stream       |

## RPM note (Fix #2)

deepseek-v4-pro: Tilotma + Shubham + Aanya share ONE 40 RPM bucket.
Not 3×40=120. The `@nexsidi/llm-client` token bucket enforces this.

## Phase 2 (Planned)

Kabir, Sayan, Dhruv, Aryan, Ishaan (mobile/desktop)
Ishan, Naina, Sid (post-production)
Neha (knowledge + CVE feeds)
Red Team, Blue Team (internal platform security)
