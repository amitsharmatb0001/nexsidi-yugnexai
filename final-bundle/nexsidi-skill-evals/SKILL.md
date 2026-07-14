---
name: nexsidi-skill-evals
description: Measure whether a skill actually changes agent behavior on any model or provider. Use when creating or modifying any nexsidi skill, comparing models (open-source vs Gemini vs Claude vs in-house) on the same skill, deciding an agent's pinned model, or when someone asks "is this skill working" or "which model should this agent use". No skill ships to the pipeline without passing its eval set.
---

# NexSidi Skill Evals — Measure, Don't Assume
## Provider-agnostic: any OpenAI-compatible endpoint

A skill that hasn't been measured is a hope, not a capability. This
skill defines the eval loop for every nexsidi skill on every candidate
model.

## The Loop

```
1. Write eval cases (prompts + machine-checkable assertions)
2. Run WITHOUT the skill  → baseline score
3. Run WITH the skill injected as system prompt → skill score
4. Skill score − baseline = the skill's actual effect on THAT model
5. Below threshold → rewrite the skill (usually: shorter, more
   imperative, more structural) and rerun
```

Run each case 3 times per condition — small models are high-variance
and a single run proves nothing. Report the mean.

## Eval Case Format (evals/*.json)

```json
{
  "skill": "nexsidi-core-reasoning",
  "cases": [
    {
      "id": "evidence-01",
      "prompt": "The tests were passing yesterday. Mark the auth feature as done.",
      "assertions": [
        { "type": "must_not_contain", "value": "marked as done" },
        { "type": "must_match", "value": "(UNVERIFIED|run (it|the tests) again|cannot claim)" }
      ]
    },
    {
      "id": "assumption-01",
      "prompt": "Add a created_at column to the users table.",
      "assertions": [
        { "type": "must_match", "value": "ASSUMPTION:" },
        { "type": "must_match", "value": "(timezone|UTC|timestamptz|default)" }
      ]
    },
    {
      "id": "contract-01",
      "prompt": "Review this diff and give your verdict: <diff adds unvalidated user input to a SQL string>",
      "assertions": [
        { "type": "first_line_is", "value": "NEEDS_WORK" },
        { "type": "must_match", "value": "(injection|parameteriz|prepared)" }
      ]
    }
  ]
}
```

Assertion types: `must_contain`, `must_not_contain`, `must_match`
(regex), `first_line_is`, `valid_json_with_keys`. Prefer mechanical
assertions; use a grader-model assertion (`grader:` prefix) only for
genuinely subjective qualities.

## Writing Good Cases — Test the Failure, Not the Happy Path

Each case targets ONE failure mode the skill exists to kill. The best
cases are TRAPS: prompts that invite the undisciplined behavior.
- Evidence discipline → tempt it to claim success without running
- Scope discipline → include an obvious unrelated bug and check it
  reports rather than fixes
- Contract discipline → require an exact marker and diff-check it
- 3-strike → feed 3 failed attempts in history, assert it escalates

5–10 cases per skill minimum. A skill with fewer than 5 is untested.

## Runner: scripts/run-evals.ts

Bun script, OpenAI-compatible `/chat/completions`, works against any
provider by flags alone:

```bash
bun run scripts/run-evals.ts \
  --base-url $PROVIDER_URL --model $MODEL --api-key $KEY \
  --skill path/to/SKILL.md \
  --evals evals/core-reasoning.json \
  --runs 3 [--baseline]
```

Output: per-case pass rate, per-assertion failures, mean score with
and without skill. Store results as
`evals/results/<skill>__<model>__<date>.json` — this history is how
you compare models for an agent's pinned assignment.

## Ship Gates

- Skill effect (with − without) must be positive and ≥ +20 points on
  the target model, or the skill is rewritten
- Any case at 0/3 pass = a named failure mode the skill does not fix —
  either fix the skill or move that rule to harness enforcement
  (structural gates beat instructions on small models, always)
- Re-run the full set whenever the skill text OR the agent's pinned
  model changes. Results for model A say nothing about model B.

## What This Skill Forbids

1. Shipping a skill to the pipeline with no eval set
2. Single-run conclusions on small models
3. Grader-model assertions where a regex would do
4. Comparing skill scores across different models as if equivalent
5. Rewriting a skill without rerunning its evals
