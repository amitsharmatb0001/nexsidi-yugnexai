# NexSidi Skill Evals — Quick Start

Provider-agnostic: any OpenAI-compatible /chat/completions endpoint
(open-source servers, Gemini OpenAI-compat, Claude via compat proxy,
NIM, in-house).

## Measure a skill's effect on a model

# 1. Baseline (no skill):
bun run scripts/run-evals.ts \
  --base-url $URL --model $MODEL --api-key $KEY \
  --skill ../nexsidi-core-reasoning/SKILL.md \
  --evals evals/core-reasoning.json --runs 3 --baseline

# 2. With skill:
bun run scripts/run-evals.ts \
  --base-url $URL --model $MODEL --api-key $KEY \
  --skill ../nexsidi-core-reasoning/SKILL.md \
  --evals evals/core-reasoning.json --runs 3

# 3. Skill effect = (with) − (baseline). Ship gate: ≥ +20 points.

Results land in evals/results/ — keep them; they're your model-selection
history per agent.
