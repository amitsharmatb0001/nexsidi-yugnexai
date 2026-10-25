# One-pass build: what changed after Brewline 3, and what is still unproven (2026-10-25)

Goal (Amit): a clean build in about an hour, not four; every finding found once, fixed once; no more paid builds spent discovering the same classes of problem.

## Why Brewline 3 took 233 minutes and $36 (ledger)

| Cause | Evidence | Fix | Batch |
|---|---|---|---|
| Builders never checked their own work against the plan the reviewers judge them by | no builder path used the SC/EP/ROLES/DESIGN/SEC/INT items | each builder gets its items and cannot finish until its summary lists each with a file | 54 |
| Known problem classes found one or two per review round | metadata 825 chars of spec, `seedStaff.ts:29` password log, two stray compose files with weak secrets, `secure` cookie | deterministic finish checks (no model); all four reported on Brewline 3's real code | 54 |
| Chief AI check judged on code cut at 8,000 characters and ruled "not true" when it could not see | 2 dismissals, one genuine | cited lines shown (head + 80 lines around each cited line), "not true" needs a quote | 53 |
| Backend and database builders had different rules for order history | name vs price only; one finding in 8 of 13 rounds | one rule naming `name_at_time` and `unit_price` | 52 |
| Confirmed finding went back to whoever disputed it | 3 rounds on one finding | goes to the owner of the file it names | 49 |
| Backend builder could not read the migrations in a fix round | `ls ../db/migrations` refused | migrations in the task text, word for word | 51 |
| A check asked the backend builder to change files it cannot write | 11 minutes and a failed attempt ($3.6) | the system rewrites the key; the migration check runs in review | 44–45 |
| Reviewer's first call cut off at 240 s five times | writes 15K–25K tokens | 360 s for review-sized requests | 48 |
| Later rounds read only changed files, defects surfaced late | secure cookie in round 10 | one full pass by every reviewer before a build may pass | 55 |
| Frontend waited for the whole backend | generation 16–21 min then 23 min in a row | frontend prepares beside the backend, integrates after it | 55 |
| No stage had a time limit | review loop about 2 h, live stage 45 min | 40 and 30 minute budgets, then hold with the open findings | 56 |
| Slow flash model started the third helper | 3.8-flash median 59 s vs 8 s | 3.8 last in the builder pool | 46 |

## Honest expectation for the next clean build (estimate, not measured)

| Stage | Brewline 3 | Expected |
|---|---|---|
| Requirements + plan | 12 min | 12 min |
| Generation | 16–21 min backend, then 23 min frontend | about 30 min (frontend overlaps) |
| Compile check | 2.5 min | 2.5 min |
| Review | about 2 h | 20–45 min (first full pass, one fix round, one full pass; budget 40) |
| Deploy + live | 45 min | 15–30 min (budget 30) |
| Total (without the approval wait) | about 4 h | about 80–110 min |

An hour is not the expected figure; the best case is near it. The cost of a clean path, from Brewline 3's own windows: planning and plan about $0.5, backend $2–3.6, frontend $3.8, first review $1.7, one fix round about $1.6, the final full pass $2–3, live round and one live fix about $2.5, deploy $1: about $14–17. Brewline 3 spent $36.

## Not proven yet

- None of parts A–D has run in a real build. Each was proven by tests and, where possible, by replaying Brewline 3's recorded data with no model call.
- Whether builders write a truthful checklist (the system checks that each item has a file named, not that it is right).
- Whether the frontend's prepare step works well while the backend is still being built (it is the design the phased builds already used).
- The new-database migration check inside the worker (async docker call, confirmed from a shell only).
- The hours mismatch is covered by a spec rule and a yardstick item, not by a deterministic check.

## Next step (needs Amit's go: it spends money)

One verification build of a small spec, watched in Chrome, with the per-call ledger report at the end, to compare against the table above.
