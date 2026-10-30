# Patent alignment: build notes

A running log of each piece built to close a gap against the filed provisional specification. One entry per feature, written when the feature is finished.
Each entry says what was built, where it is, how it was proven, and what it does NOT do. Status tables: `docs/patent-alignment.md` and `docs/patent/for-the-lawyer.md`.
Commits are made after every 3 to 4 features; the batch they belong to is named in each entry.

Rule for every entry: the proof is something that was run (a test, a real database row, a real container), not a statement that the code exists.

---

## Batch 1

### F1. Mistake memory uses statistics (claim 7)

**Gap:** the memory only counted repeats and moved confidence one step up each time. It could not tell a weakness that recurs across projects from an accident in one project, or from a pattern that is simply common everywhere.

**Built**
- `packages/db/src/instinct-stats.ts` (pure, tested): for each pattern, counts the distinct projects it appeared in; estimates the background rate from all other patterns; exact one-sided binomial test; Benjamini-Hochberg correction across all patterns tested; minimum evidence (3 projects and 3 occurrences) before a pattern is kept.
- Migration `0012_instinct_statistics.sql`: new table `instinct_occurrences` (one row per sighting), and on `instincts`: `occurrences`, `project_count`, `significance`, `significant`, `evaluated_at`.
- `recordInstinct` now logs every sighting with its project and counts occurrences. The QA fix loop and the live design review now pass the project id.
- `evaluateInstincts()` runs the test over the log and stores the result on each pattern. It runs at the start of `pipeline/instinct-cron.ts` when that is run directly.
- `queryRecentInstincts` returns statistically significant patterns first, so they are the ones put into agent prompts (claim 7's "prompt modification").

**Proof**
- 11 unit tests (`packages/db/src/instinct-stats.test.ts`) including: a pattern in 12 of 20 projects is significant; 30 repeats inside one project is not; a busy background makes a common pattern unremarkable; 40 noise patterns give zero false winners.
- Real database run: a pattern recorded from 6 different projects scored 3.346 and was marked significant; a pattern repeated 6 times in one project scored 0.122 and was not; the significant one came first in the list given to prompts. Test rows were removed afterwards (0 left).

**Does not do / limits**
- The old confidence ladder is unchanged, so a single-project pattern can still reach confidence 0.9 by repetition. Significance is a separate field, used for ordering.
- Sightings recorded before this change have no project id; they count as occurrences but not toward the cross-project claim.
- Evaluation is not scheduled by itself; it runs when the cron script is run.
- The background rate is estimated from our own data, so with few projects the test is weak. It needs more projects to say much.

**Batch:** 1

### F2. Container gaps closed as far as one machine allows (claims 1(e), 2(d), 5)

**Gap:** the container runner had no disk-speed limit, its time limit was a timer in our own process, nothing said which isolation layers the host really provided, and it was off everywhere.

**Built** (`packages/agent-runtime/src/sandbox/container-sandbox.ts`)
- Disk read and write bandwidth cap, applied through the container engine's cgroup v2 `io.max`. The block device is found by trying likely names against the daemon (`detectIoDevice`); if none is accepted, the run goes ahead and reports `ioLimit: "unavailable"`.
- The time limit now runs inside the container as `timeout -s KILL`, a kernel interval timer. The host keeps a later timer as a backstop. The command is started by a shell so `timeout` is not the container's first process (found by experiment: as the first process the kernel ignores the signal and the limit never fires).
- `hostIsolationReport()`: reads the Docker daemon and lists each layer as active or missing, including user-namespace remap.
- `sandboxDefault()`: on by default on Linux, off elsewhere, overridable with `NEXSIDI_SANDBOX_BUILDS`. Used by `pipeline/orchestrator/verify-commands.ts`.
- `docs/sandbox-linux-server.md`: how to turn on user-namespace remap and how to check a server.

**Proof**
- Real containers: the kernel's own `io.max` showed the 25 MB/s cap for the detected device; `sleep 60` with a 2 s limit ended at the limit with exit 137 and was reported timed out, and the container was gone; a command that exits 3 inside its limit reports exit 3 and not timed out; the host report read the live daemon. Pure tests cover the arguments, device detection, the report parser and the default switch. 36 tests pass (sandbox and build-command suites); type checks clean.

**Does not do / limits**
- User-namespace remap is a daemon setting. It is not on here (the report shows it as missing on this machine); it needs a Linux server and the steps in the doc.
- The timer is a kernel interval timer inside the container, not a hardware timer; whether that matches the filed wording is for the lawyer.
- Needs an image with `sh` and `timeout`; other images must run with `kernelTimer: false` (host timer only).
- Not exercised on a real Linux server; only on Docker Desktop for Windows.

**Batch:** 1

### F3. The handoff carries a code map (claims 1 and 3)

**Gap:** the handoff that carries generated code held only a sorted list of file names. The filing describes a context object with the code's syntax structure, its dependency graph and metadata, the rules to follow, and error records.

**Built**
- `packages/context-chain/src/code-map.ts`: for each source file a SHA-256, line count, language, a digest of its syntax tree (the sequence of node kinds, so renames, comments and spacing do not change it) with a node count, what it imports, exports and declares (functions, classes, interfaces, types, enums, variables; SQL tables). Project-wide: the file-to-file dependency graph (resolves `./x`, `.js` names for `.ts` files, folder `index` files and `@/` aliases through the nearest `tsconfig.json`), the external packages and which files use them, and import cycles (Tarjan). Error records: syntax errors with line numbers, imports that point at nothing, files listed but missing, files too large to parse. `dependentsOf` and `dependenciesOf` answer "what does a change reach".
- `pipeline/activities/handoff-context.ts`: `rulesFromPlan` turns the plan into plain rules (each feature, each endpoint with its sign-in requirement, each table with its columns); `buildHandoffContext` builds the file list plus code map; `latestCodeMap` reads the newest map back from a project's handoff files.
- The quality-check-to-deploy handoff (`recordDeployHandoffActivity` and the check in `runDeployWithLiveRetest`, plus `pipeline/redeploy.ts`) now records and verifies this whole object. Both sides build it with the same function from the files on disk.
- The map covers source code, SQL and CSS only. Files that build tools rewrite on their own (`tsconfig.json`, `package.json`, `next-env.d.ts`) are left out so a healthy project is not rolled back; the file list still names every file.

**Also fixed (found while doing this, from the earlier batch):** the file list for this handoff did not exclude the chain's own `.nexsidi` folder, where handoff files and snapshots are now written after a handoff is recorded. The list at deploy time would have differed from the recorded one and rolled back a healthy project. `.nexsidi` is now excluded (`filterSourceManifest`, with a test).

**Proof**
- 13 unit tests for the map and 5 for the handoff context; 34 context-chain tests pass; type checks clean.
- On a real generated app (46 mapped files, 2,762 lines): 45 dependency edges, 10 external packages, 0 cycles, 0 error records; the hash is identical on a rebuild; adding one comment line to one file changed it; restoring the file brought the original hash back; a change to `Header.tsx` reaches 8 files. The map took about 150 ms.

**Does not do / limits**
- The code map is not used by the receiving agent for decisions yet; it is recorded, hashed and verifiable, and `latestCodeMap` can read it. Using it to guide fix steps is not built.
- Only the quality-check-to-deploy handoff carries code; the earlier ones (spec, plan) carry no code to map.
- The syntax digest reflects node kinds, not names or literal values; the file hash catches those.
- The QA findings are not part of the hashed object (they change as the fix loop runs and would cause false rollbacks); the error records are those found in the code itself.
- Content changes to mapped files during the human-approval wait are now caught (before, only added or removed files were).
- `typescript` is used from the repository root; the context-chain package does not list it as its own dependency.

**Batch:** 1

### F4. Requirement-to-code traceability (claim 3)

**Gap:** nothing linked a piece of code back to the requirement it came from, or a requirement forward to its code.

**Built** (`packages/context-chain/src/traceability.ts`, wired through `pipeline/activities/handoff-context.ts`)
- A graph in three layers with no cycles: requirement, then task, then file. Requirement ids are stable (`REQ-` plus six characters of a hash of the name). A requirement is linked to a task when words distinctive to its name appear in the task's description or file names (words shared by several requirement names, such as "client", are ignored; a weaker rule needs three matching words from the requirement description). A task is linked to a file when the file the plan named exists, or, when the generator named it differently, when a non-generic word in its path appears in the task wording (file extensions and words like "index" or "layout" never count).
- Every link carries its reason. Queries: files for a requirement (forward), requirements for a file (backward), and impact (the requirements of a file and of every file that imports it, using the code map). It lists requirements no code implements and files no requirement explains.
- It is carried in the same hashed handoff as the code map.

**Proof**
- 12 unit tests. On 8 real projects on disk: 38 of 39 requirements traced and 307 of 479 files linked. On one real app, each of 7 requirements came out with 1 to 3 files (for example Client Authentication to the backend entry and the sign-in page; Company Vision to the about, mission and vision pages), and a change to the shared header page was shown to reach 6 of 7 requirements through the pages that import it.
- A first version over-linked (about 21 files per requirement) because file extensions counted as matching words; found by running it on real builds, fixed, and covered by a test.

**Does not do / limits**
- Links come from matching words, not from the generators declaring which requirement a file serves. Some links are wrong (for example a database config file tied to two requirements) and some are missing (about a third of files are not linked: shared layout files, generic helpers, and files the plan never described).
- Quality-check findings are not linked in yet, so "which requirement does this bug affect" is answered through the file, not from the finding.
- The one requirement not traced in the real projects is a test project with no tasks.

**Batch:** 1 (F1 to F4)

---

## Other work (not a patent item)

### Move older projects under one account

**Need:** older projects belong to different accounts (amit@yugnex.com, amitsharma.tb0001@gmail.com, a test account), so they do not all show in one place.

**Built:** `scripts/consolidate-projects.ts` (database access in `packages/db/src/project-store.ts`).
- Ownership is one column, `projects.user_id`; everything else (build folders, lineage, costs, chain records) is keyed by project id, so changing that one column moves a project completely.
- Dry run by default: lists the target, how many are already there, and every project to move with its current owner and status.
- `--apply` also needs `--confirm <target email>` typed again. The old owner of every project is written to a backup file first (in `~/.local/share/nexsidi-consolidation/`); if the backup cannot be written, nothing moves. The move is one database transaction and the count is checked afterwards.
- `--undo <backup file>` puts each project back with its old owner and leaves alone any that has been changed since.
- `--from a@x,b@y` limits the move to named owners. An unknown or ambiguous email stops the run instead of guessing.

**Proof:** 10 unit tests. On the real database the dry run showed 30 projects already on amit@yugnex.com and 10 to move (9 from amitsharma.tb0001@gmail.com, 1 from a test account). A real apply and undo cycle ran on two throwaway accounts and one throwaway project: refused without `--confirm`, refused with a wrong one, moved with the right one, undone from the backup, all throwaway rows deleted afterwards. No real project was changed.

**Not done:** it has NOT been applied to the real projects; that needs your go-ahead on the target account.

To run it for real: `bun scripts/consolidate-projects.ts --to amit@yugnex.com --apply --confirm amit@yugnex.com`

---

## Batch 2

### F5. Security pattern database (claim 8)

**Gap:** the security checker had a list of attack types as text in its instructions and no stored pattern database.

**Built**
- `packages/agent-runtime/src/security/pattern-scan.ts`: 20 code patterns, each with its OWASP Top 10 (2021) category, CWE number, severity, regular expression and the usual fix (SQL built from text, shell commands built from variables, eval, weak hashes, low bcrypt cost, predictable tokens, secret fallbacks and hard-coded secrets, raw HTML, request-controlled file paths, URLs and redirects, open cross-origin access, disabled certificate checks, unsigned tokens, and more). A scanner applies them line by line; comments, tests, vendored library code and test scripts are skipped; a line can opt out with `nexsidi-allow <key>`.
- Package advisories: 20 hand-entered CVE entries (lodash, minimist, express, jsonwebtoken, axios, next, and others) with affected version ranges and the fixed version, a version-range checker, a reader for package.json that prefers the installed version from `node_modules` over the written range, and `importOsv`, which turns an entry in the public OSV format into advisories.
- Storage: tables `security_patterns` and `security_advisories` (migration 0013), `packages/db/src/security-store.ts`, and `scripts/seed-security-db.ts` (seeds the built-in lists; `--osv GHSA-...` imports live entries from osv.dev). The scan reads the database first and falls back to the built-in lists.
- `pipeline/orchestrator/stages/security-scan.ts` runs it over a project and builds a short list of leads, worst first and capped. Stage 5 now adds those leads to the security reviewer's input, labelled as leads to confirm. A failed scan leaves the input unchanged.

**Proof**
- 22 unit tests, 5 for the project wrapper; 556 pipeline tests and the type checks pass.
- Run over 80 real generated apps (4,573 source files) it found real problems in earlier builds: 57 secrets that fall back to a default value, and apps pinned to Next 15.1 and Express 4.18, versions with published flaws. It also showed noise, which was fixed and covered by tests: about 1,000 hits in the vendored UI library, a parameterised query reported as built SQL, and test scripts.
- Checked against the live public database (osv.dev): 5 of my 6 sample advisories were confirmed. One was not: jsonwebtoken is listed there under CVE-2022-23539, -23540 and -23541, not the id I had entered. The ids were corrected and a test pins them. A live GHSA entry was imported through `importOsv`.
- Seeded on the real database (20 patterns, 21 advisories; a second run added nothing). With the real database, the older app showed its two default-secret lines and the clean app showed nothing.

**Does not do / limits**
- Patterns are regular expressions on single lines. They find what looks risky; they do not follow data (that is the taint analysis, F6). Some hits will be harmless, so they are given to the reviewer as leads, not as findings.
- The advisory list is small and hand-entered, plus whatever is imported. There is no scheduled feed: the "Neha" feed that the notes mention is a stub. Importing from osv.dev is manual (`--osv`).
- Not gated: a hit does not fail QA by itself.
- Only npm packages are covered.

**Batch:** 2

### F6. Taint analysis (claim 8)

**Gap:** nothing followed untrusted data through the code. Injection was only a word in the generators' instructions and in the reviewer's.

**Built** (`packages/agent-runtime/src/security/taint.ts`, using the TypeScript parser)
- Data from the request (`req`/`request` body, query, params, headers, cookies, url, and what a route handler reads: `request.json()`, `request.nextUrl.searchParams`) is followed through assignments, destructuring, template strings, string joins, object and array literals, method calls on it, and calls to functions defined in the same file (what a function is given, and what it returns; repeated until nothing new is learned).
- Reported where it reaches: SQL text (HIGH), a shell command (CRITICAL), `eval` or `new Function` (CRITICAL), a file path (HIGH), a URL the server fetches (HIGH), a redirect (MEDIUM), HTML sent back (MEDIUM). Each finding gives the source and its line, the sink and its line, and the variables in between.
- Cleaned by: number conversion, schema checks (`parse`, `safeParse`, `validate*`), escaping calls, `path.basename`, a safe value assigned over it, a check against an allowed list (inside the branch, or after an early exit when the value is not in the list; a list taken from the request does not count), and a query parameter (the SQL text alone is checked). Request data in the path or query of a URL on a server-chosen host is not reported as request forgery.
- Wired in: `pipeline/orchestrator/stages/security-scan.ts` runs it over server code and adds the traced paths to the leads given to the security reviewer, ahead of plain pattern hits.

**Proof**
- 23 unit tests. Run over the server code of 73 real generated apps (877 files, half a second): the first version reported 3 issues; reading the code showed all 3 were false (a sort direction checked against an allowed list, a query string added to a fixed API address). Both rules were added with tests; after that the real apps give 0 findings.
- To show it still finds things on real code: a real generated controller was copied and one line changed so the sort direction is used without the allowed-list check. The analysis reported it with the exact path: from `req.query.sortOrder` through `sortOrder → orderDir → selectQuery` to `pool.query()` at line 118. The unchanged controller gave 0 findings.

**Does not do / limits**
- One file at a time; calls into other files, class methods and `this.` calls are not followed. Loops are walked once. The request object is recognised only under the names `req` and `request` (Hono's `c.req` is not).
- Cleaning is recognised by name (`sanitize*`, `escape*`, `validate*`, `parse`), so a function with such a name that does not really clean will hide a flaw, and a real cleaning function with another name will give a false report.
- No taint from the database or other services (stored data read back and used unsafely) and none in browser code.
- Findings are leads for the reviewer; they do not fail QA by themselves.

**Batch:** 2

### F7. Performance analysis: Big-O, memory leaks, regressions (claim 9)

**Gap:** the performance checker's instructions mention slow queries and memory problems, but nothing analysed code, measured memory or compared one round with the next.

**Built** (`packages/agent-runtime/src/performance/`)
- `complexity.ts`, growth estimate from the code (TypeScript parser): nested loops and array methods that take a function (map, filter, some, reduce, find ...) add a level; a sort is n log n at its level; a linear search (`includes`, `indexOf`) inside a loop adds a level; loops with a small fixed bound or over a list written out in the function do not count. Result per function: O(1), O(n), O(n log n), O(n²), O(n² log n), O(n³) or O(2^n) (two self-calls with no cache), with the reasons and lines. A database or network call made inside a loop or an array callback is listed on its own (one round trip per item, the "N+1" pattern). Route handlers are named by method and path. Capitalised functions in `.tsx` files are labelled page components.
- `leaks.ts`, two ways to find leaks. (1) Code patterns: a list, map or set at the top of the file that functions add to and nothing trims; a listener added to a long-lived object on every request; a timer started on every call; a new connection pool or client inside a request handler; a connection taken from a pool and never released. (2) Measuring: `runLeakProbe` calls given routes with GET only, reading memory after every round, and `detectGrowth` fits a straight line (first quarter of readings ignored as warm-up) and reports a leak only if memory climbs steadily with the request count. A rise that is collected again, or a flat line with noise, is not reported.
- `regression.ts`, comparison with the previous round: a function whose estimate went up, a new quadratic function or per-item call, a new leak pattern, a route whose 95th-percentile time rose by 25% and 50 ms, memory that began to climb. Functions are known by file and name, so moving code is not a change. Snapshots are kept in `<project>/.nexsidi/perf-history.json` (written whole, then moved into place).
- `pipeline/orchestrator/stages/performance-scan.ts` runs all this over a project and Stage 5 now gives the result to the performance reviewer as leads (regressions first, then leaks, then server functions, then page components), and records the round.

**Proof**
- 39 unit tests in the performance folder, 5 for the wrapper; 671 pipeline tests and the type checks pass.
- On 2,707 real functions in 73 real apps it took about 1 second. The first run flagged a seed loop over five fixed rows as a query per item, which is not one; fixed with a test (loops over lists written out in the function are bounded).
- Code patterns on 871 real backend files found 3 maps that grow forever and are never trimmed: a rate-limit map keyed by caller, a user cache, a metrics store.
- Measured on two real running servers (started for the test): the one that keeps every request's data showed memory rising 18.8 MB per 1000 requests (fit 0.99; 4.0 to 34.1 MB over 2,000 requests) and was reported as a leak; the one that does not stayed at 0.3 MB and was not.
- On real apps, the performance leads for the older app showed the rate-limit map; the clean app produced nothing.

**Does not do / limits**
- The estimate reads the structure; it cannot know how large n is or what a called function costs. Page components often nest lists over short lists, so they are listed last and labelled.
- The leak probe and the route timings are NOT run automatically by the pipeline yet: they need a running app and a way to read its memory (a container's memory, or a number the app reports). The code is tested on real servers, but it is not part of a build. Regressions in route timing and memory therefore only appear when a caller supplies those snapshots.
- Leak patterns are per file and by name; a map trimmed in another file will still be reported.
- A leak that comes from a library, or from data kept in the database, is not seen.
- Leads, not findings: nothing here fails QA by itself.

**Batch:** 2

### F8. Adversarial training of the checkers: example database, curriculum, scoring (claim 4)

**Gap:** the checking agents were given instructions only. Nothing planted known defects to see whether they were found, nothing kept the defects they missed, and nothing raised the difficulty as they improved.

**Built** (`packages/agent-runtime/src/training/`)
- `mutations.ts`, the defect planter: 11 defects at five levels, put into a copy of real code (the text is returned; no file is changed). Level 1 obvious (eval of text, a password in the code); level 2 one line (SQL built from text, MD5 instead of SHA-256); level 3 logic (the sign-in check removed from a route, a loop one past the end, a caught error swallowed); level 4 structure (a list that grows on every request, the request body used without its schema check); level 5 subtle (the owner filter dropped from a query, the role read from the request body). Every planted change is still valid code, is recorded with its line, and gets a stable id.
- `trainer.ts`, one training round: plants at most one defect per file, runs the checker on the changed copies and on the originals, and counts a defect as caught only if the checker reported something new, within 3 lines of the planted line or in the words for that defect. The baseline run means old complaints are not credited. It also reports new findings that match no planted defect (real finds or false alarms).
- `curriculum.ts`: starts at level 1; over the last two rounds at a level, 80% or more caught moves up, under 40% moves down, anything between stays.
- The adversarial example database (`adversarial_examples`, `training_rounds`, migration 0014, `packages/db/src/training-store.ts`): every planted defect per checker with how many times it was caught or missed, and every round with its counts.
- Feedback: `pipeline/orchestrator/stages/training-feedback.ts`; Stage 5 adds "defects that reviewers like you have missed before", with the example code, to the input of each of the three reviewers. Nothing is added when there is nothing missed or no database.
- `scripts/train-checkers.ts`: runs rounds on real generated apps and records them. The built-in static checker (pattern scan, taint analysis, leak and growth checks) is free. Running a model-backed reviewer needs `--allow-model-spend`; without it the script stops.

**Proof**
- 20 unit tests for the planter, curriculum, judging, store and prompt text; 3 for the feedback; 674 pipeline tests and the type checks pass.
- Real run on 83 real generated server files from 8 apps, written to the real database: level 1, 100% caught (12 of 12, twice); level 2, 100% (7 of 7, twice); level 3, 0% (12 planted, none caught); the curriculum moved up twice and then back down as designed. The database holds 6 rounds and 52 examples for the static checker, and the text a reviewer would be told was read back from it.
- The loop found a real gap in my own scanner: before the fix only 80% of level 2 defects were caught (32 of 40), because a query call and its text on different lines were not recognised. After adding the two-line check and the backtick form, level 2 reached 100% (40 of 40), and the unchanged real code gave the same hits as before, so no new noise.
- The static checker catching nothing at level 3 is expected: a missing sign-in check or a swallowed error cannot be seen by patterns. That is the work the review agents are for, and those missed examples are exactly what is stored for them.

**Does not do / limits**
- No model weights are trained. This is an adversarial loop with a store of the opponent's successes, a difficulty ramp and feedback into the prompt. Whether that is what "GAN-based training, generator/discriminator dynamics" in the filing means is for the lawyer. In particular, the defect planter is not a learned generator: it is a fixed set of 11 rules, so it cannot get better at fooling the checkers.
- Only the static checker has been run through the loop. The three model-backed reviewers have an adapter (`--checker karan|navya|deepika`) but have NOT been trained or measured yet, because each round spends model money. Their prompts get missed examples only after such rounds are run.
- Judging is by place and words, so a checker that reports something loosely near a planted line is credited; the 3-line window keeps that small.
- At most one planted defect per file per round, and the set of defects is small. It will not cover a checker's real blind spots.

**Batch:** 3

### Added: gemini-4-argon for the hardest reasoning work

**Need:** use the new model (model card `gemini-4-argon.md`: general release 2026-10-13, 1M tokens in and out, text output) for the toughest, most reasoning-heavy and most critical work, without putting the rest of the pipeline at risk.

**Built**
- A new model tier, "critical" (`packages/llm-client/src/router.ts`): `gemini-4-argon` first, then the models already proven in this pool in the same order as the plan tier (3.1 Pro, 3.8, 3.7, 3.6, 3.5 Flash). If argon is unavailable, over quota or errors, the pool moves to the next model at once. Thinking level HIGH. No other tier uses argon. `GEMINI_CRITICAL_ARGON=off` removes it without a code change.
- Used for: Saanvi and Arjun (the plan that decides what gets built, which everything after depends on), the reality checker's final verdict (`tilotma-reality-checker`), and the dispute settler. NOT used for the browser evidence collector, the builders, or the quality reviewers, which stay on their pools (cost: argon is about twice the price of 3.1 Pro).
- Spend table: priced at $4 in / $20 out per million tokens, cached input $0.20, in `cost-budget.ts`, so the budget guard counts it correctly (a test requires every model in every pool to be priced).
- `scripts/probe-gemini-model.ts`: five checks to run before relying on any Gemini model (plain answer, strict JSON, tool call, a conversation ending on a model turn, thinking level HIGH).

**Proof:** 8 new router tests, 1 new price test, and the existing suites updated where they asserted the old planner tier; all suites and type checks pass.

**NOT proven, and why**
- The model has not been called from this code. On 2026-10-21 billing is disabled on every Google Cloud project configured here (`ai-nex`, `aiayug`, `nexai-asst`; the `ai-yug` key no longer exists). Every Gemini model fails the same way, including the ones the pipeline already uses. Run `bun scripts/probe-gemini-model.ts` once billing is on.
- The price comes from third-party pages, not Google: they report $2/$10 introductory (through about 2026-11-30) and $4/$20 from 2026-12-01, with cached input 95% off. The standard rate is used from the start, so the budget over-counts by about half until then. One page also says access is a restricted preview; the model card says general release. Verify both.
- The model's own API changes ("developers guide" link in the model card) have not been read; if thinking or tool-call parameters differ, the probe will show it.

### Added: end-to-end smoke test of the running platform

`scripts/e2e-smoke.ts`: signs up two throwaway accounts on localhost and checks 40 things a person depends on (sign-up, sign-in, session cookie flags, projects create/read/rename/transfer/delete, one account cannot see or change another's project, clean errors on bad input, the web pages, no internal agent names on the public page). It never calls a model. Run on 2026-10-21 against the real API and web app: 39 passed, 0 failed, plus one known gap below. The throwaway accounts and their projects were removed afterwards; the 40 real projects were checked unchanged.

**Finding (known gap, a product decision):** the file tree, file contents, build plan and pipeline status routes are public so the build page works before sign-in, and approve-spec and approve-deploy are public too (`apps/api/src/app.ts`). The 12-character project id is the only key, so any caller with an id (a shared link, for example) can read that project's generated files, and can approve its deploy. The smoke test prints this on every run. Not changed: removing it would affect the anonymous build page. Options: require a signed-in owner on those routes, or give each project a separate long random key in the link.

**Also noted:** a per-project transfer route already exists (`POST /api/projects/:id/transfer`, owner only, one at a time); `scripts/consolidate-projects.ts` is the bulk version.

### Real full-pipeline test: Trailhead Gear Rentals (2026-10-21 to 22)

A new app (outdoor-gear rental shop) was built through the chat page in Chrome, signed in as the owner account, with every approval clicked in the UI. Project `88368631db38`, worker on `COST_BUDGET_CAP_USD=25`. Spend by the end: about $17 or more (last guard line: $16.87 at live round 4; the final round is not in that figure).

**What the log and the disk show**
- `gemini-4-argon` ran in the real build: Saanvi's spec (4809 in / 4408 out), Arjun's plan (three calls), the reality checker (about 12 iterations reading the live app and its source) and the dispute settler. One dispute was settled: Pranav said "missing index on bookings.user_id"; the settler read `db/migrations/0000_initial.sql`, found both indexes already there (lines 59-61) and dropped the finding as not true.
- Handoffs are on disk, `.nexsidi/handoffs/0001` to `0012`, and the log shows recorded and verified lines for saanvi to arjun, arjun to the three builders, and qa-gan to deploy. The deploy handoff holds a code map (63 files, 75 dependency edges, no cycles) and a traceability graph (5 requirements, 11 tasks, 73 edges, no requirement without code). Snapshots exist for each handoff. `.nexsidi/perf-history.json` holds 5 rounds of per-function growth estimates (the data for regression detection).
- Quality review ran 4 iterations: round findings 6, 6, 2, then 0 from all three reviewers.
- The live retest found real defects the earlier stages did not: the pages were 109px and 189px wider than a 375px phone (header items did not fit), a text-contrast problem in the gear card, and a hotlinked photo that the browser blocks. Each was fixed by the builders and the sweep then passed (32 page visits).

**NOT checked in this run** (no evidence was captured, so nothing is claimed)
- That the security pattern leads and the Big-O/leak leads reached Karan and Deepika: the stage prints nothing on success and no "scan skipped" line appeared; the text sent to them was not captured. Karan and Deepika reported 0 findings in the last rounds.
- That any missed-example text was added to Karan's prompt (only Karan was ever trained, and the prompt was not captured).
- Mistake-memory statistics, the container sandbox default for generated code, predecessor hashes inside the handoff objects (claim 10 form), and the snapshot restore path (no mismatch occurred, so no restore).

**The build ended in an error state, not delivered through the pipeline.** The app itself is up (frontend 3200, backend 3300, database 5435; pages, health and the gear list answer 200) but the workflow ended with `deploy_failed` after three live-retest rounds plus one automatic retry.

**Platform defects found, and what was done**
1. **Fixed:** the data-cleanliness gate failed the deploy on `contact_submissions: 16 rows before the testing, 20 after the cleanup`. The cleanup only searched tables that hold accounts (an email plus a password). A public form table has an email and no password, so the checks' `@example.com` rows in it were never removed, and every retry added more. Now such tables (email and created_at, no password column) are cleaned too, but only rows made since the testing began and only on the reserved test domain, so a customer's own rows are never touched (`agents/riya/src/index.ts`, `stage6-deployment.ts`). Proof on the real delivered database: 20 test rows removed, other tables unchanged; a control run kept a real `gmail.com` row and a 2-day-old test-domain row and removed only the new test-domain row. 190 tests across the affected suites pass. The running worker still has the old code; it needs a restart before the next deploy.
2. **Not fixed, to decide:** the sample-data step posts booking dates the app refuses (`start_date and end_date must be valid dates in YYYY-MM-DD format`), so "bookings #1 was not created" appears on every round and the booking flow is never exercised with data.
3. **Not fixed, to decide:** the deploy agent's configured local model cannot make tool calls, so it falls back to a hosted model (`meta/muse-glimmer-30b`); the deploy ran, but it is not the model the roster names.
4. **Seen, transient:** the backend compile check timed out twice (`spawnSync ... ETIMEDOUT`, reported as not a compile error) and passed on rerun.
5. **Test setup:** a Chrome tab opened earlier reported a 0x0 window, so clicks on "Approve & launch" did nothing; a fresh tab worked. Not a product bug, but the approval looks identical to a working one.

### Fixed after the Trailhead run, batch 1 (2026-10-22)

- **Sample bookings are created now.** Two causes, both in the deploy checks, not the app. (1) The app asked for `YYYY-MM-DD` dates and the checks sent full timestamps; the automatic resend now understands that message and sends dates, the end a day after the start. The sample-data step now tries that resend too (it gave up at the first refusal before). (2) The contract writes the booking items inline (`items: Array<{ gear_id: string; quantity: number }>`); the field reader cut it at the first `;` inside the braces, so the items list came out empty, and ids inside lists were never filled with real ones. Fields are now split only at the top level, and `*_id` values are filled at any depth. Proof on the live Trailhead app: 2 bookings with their items and 2 contact rows created, nothing reported as not created, and the cleanup returned every table to its earlier count.
- **Type check time limit** raised from 60 s to 180 s for the direct `tsc` call; it timed out twice while three builders shared the machine, each time costing a retry.
- **The deploy agent's model.** It was assigned the local model, which cannot make tool calls, so it was skipped on every deploy and the first hosted model ran instead. Its assignment now names the hosted chain it actually uses. Pranav keeps the local model first (not checked here whether Pranav's work needs tools).

### Added: evidence for every claim step, and the container sandbox in the full pipeline (2026-10-22, batch 2)

**Need:** after the Trailhead build, several claim steps could not be shown to have run, because they print nothing when they work.

**Built**
- `packages/agent-runtime/src/claims-evidence.ts`: each claim step appends one line to `<build>/.nexsidi/claims-evidence.jsonl` (under `.nexsidi`, which the handoff manifests exclude, so it never changes a handoff hash). Never throws; never creates a build folder that does not exist yet.
- Hooks: claim 1 (task graph with capability assignment, each verified handoff, each round of the three reviewers with their finding counts), 2 (each deploy attempt and whether it passed), 3 (each handoff recorded as one unit, with what it carries; each rollback with files restored), 4 (characters of missed training examples given to each reviewer), 5 (each type check in the container), 6 (how the review loop ended), 7 (rules stored from findings; rules added to each builder's prompt), 8 (pattern and advisory counts, hits, taint paths, size of the leads sent), 9 (files analysed, concerns, leaks, regressions, earlier rounds compared), 10 (each handoff's number of predecessor hashes and its chain hash).
- `bun scripts/claims-report.ts <project>` prints all ten claims as SHOWN or NOT SHOWN with the evidence, and re-checks the whole hash chain from the database. On the old Trailhead build: no evidence lines (the hooks did not exist then) and the chain re-check VALID over 12 records.

**Found and fixed: claim 5 was not in the full pipeline.** The container sandbox was used only by the Express Build path. The full pipeline's type check now runs inside the container when `NEXSIDI_SANDBOX_BUILDS=on` (the default on Linux; off by default on this Windows machine because folder sharing is slow). Proof: the Trailhead backend type check ran in the container on this machine, clean, in 21 s; the host report shows cgroup v2, the seccomp whitelist and private namespaces active, user-namespace remap not active (a daemon setting for the Linux server); no container was left behind.

**Not done:** Navya and Deepika have still never had training rounds (they cost model money), so claim 4's evidence will show 0 characters for them.

### Added: app quality rules from the hands-on review of Trailhead (2026-10-22, batch 3)

Found by reviewing the delivered app by hand (screenshots at 1366 and 375 wide, a real booking through the API), not by any check:
- **Phone header:** wrapped into three rows, 145px of every phone screen (measured with the sweep's own expression). The route sweep now measures the header's height on a phone and fails it above 120px; the fix text tells the builder to fold the links into a menu button. The frontend builder's rules say the same.
- **Emoji as product pictures and icons:** 12 places in 4 files (backpack, bed, tent and calendar emoji). A new static check (`emoji-ui-check.ts`) runs in the review stage next to the dead-button check and fails the round with one finding per file; typographic marks (©, ™, ®, ✓) are not counted. On the real Trailhead frontend it reports exactly those 4 files and 12 lines. The frontend builder's rules now forbid emoji in the UI.
- **Prices:** the backend seeded dollar-like prices (12 a day for a 65-litre pack) and the frontend showed them in rupees. Rules added for the backend builder (who writes the seed), the database builder and the frontend builder: one currency, from the spec, believable prices. No automatic check: a believable price cannot be judged mechanically.

### Fixed: the platform's own chat, status and privacy gaps (2026-10-22, batch 4)

- **`/chat` was a dead second copy of the planner chat.** It used class names for a CSS library this app does not have (so it rendered unstyled), nothing linked to it, and it lacked the research and question widgets of the real chat on the build page. It now redirects to Projects; the old component and its test are removed. Note: "New project" (the full build) is hidden by Amit's 2026-10-13 decision behind `NEXT_PUBLIC_FROM_SCRATCH=1`; the code default stays off.
- **The real chat (build page) dropped updates split across two network reads**, such as a question with its long signature or the research notes. Lines are now joined across reads before parsing (test added).
- **A build stopped for the owner's decision was listed as "Queued..."** (status `needs_review` had no message). It now reads "Stopped: needs your decision" and counts as needing approval.
- **Privacy (the smoke test's known gap): closed.** The build page's public routes (pipeline status and plan, file tree, files, build plan, chat history, approve-spec, approve-deploy, the live stream) accepted anyone with the 12-character project id. A project owned by a signed-in user now answers only to that owner; anyone else gets 404. Anonymous projects stay open as before. The build page now sends the sign-in cookie on those calls. Proof: without sign-in, all six routes tried answered 404; in the owner's Chrome the Trailhead build page loaded its status, files, plan and chat (all 200); the smoke test now checks a second account is refused the file tree, pipeline status and deploy approval: 42 passed, 0 failed (its throwaway accounts removed afterwards).
- **Correction:** an earlier note in this session said the chat page "type-checked clean"; that command never ran (`npx tsc` is not available inside `apps/web` and the filter hid the message). Real type checks now: `node node_modules/typescript/bin/tsc --noEmit -p apps/web` and `-p apps/api`, both exit 0.

### Fixed: three causes of the hold on the Trailhead rerun (2026-10-22, batch 5)

The rerun (project `163c39fec924`) was held by the progress guard after review round 2, $13.51 spent. Read from the log, the build folder and the code:
- **The held finding was false.** "No index on bookings(start_date, end_date)" came back, but `db/migrations/0001_fix.sql` creates that index (the fix had held). The performance reviewer also reported a missing index on `bookings(user_id)`, which `0000_initial.sql` line 50 creates. The same false class happened on the first Trailhead build. Fixes: (1) before the guard judges a round, every finding that came back from an earlier round goes to the dispute settler; one it finds not true is dropped and remembered, so only real repeats hold (both the pre-deploy loop and the live loop, one shared helper `settleRepeatsBeforeGuard`). (2) The performance reviewer now gets the indexes that already exist, read from every migration file in order, as facts with its leads; on this build that list holds exactly the two indexes it had reported missing.
- **A real bug was left half-fixed.** A backend fix round was asked to batch the booking-items insert; it wrote the placeholders as `(1, 2, 3, 4)` instead of `($1, $2, $3, $4)`, spent its steps on the required live check, found its own bug at step 40 and stopped there: 40 is the generic default, while generation phases doing the same live check were tuned to 90 from real overruns. Fix rounds for both builders now get 60 steps.
- **Seen, not fixed:** the fix round left two throwaway scripts in the backend (`test-api.js`, `test-flow.js`). Builders may write any file in their own folder; nothing removes scratch files before delivery.

Tests: 699 pass across the builders and the orchestrator.
- **Retry after a hold could never pass (found on the retry).** The new repeat check worked: both repeated findings went to the settler and both were confirmed true (the broken insert, and TLS certificate checks switched off for the production database connection), so the guard held correctly. But Retry re-runs the review before any fix round; the builders never got the round-2 findings (the hold came first), so the same findings came back and the guard held again, and would every time. Now Retry writes a marker into `rounds.jsonl` and the guard compares only rounds after it, so the builders get their round; a fix that fails again after the retry still holds.

### Fixed: finished planning work was thrown away on a restart (2026-10-22, batch 6)

**Found (workflow history of the rerun):** Saanvi's spec took 1.5 minutes. Arjun's planning step started at 1.5 min, hit the 10-minute limit at 11.5 min while finishing (the log shows its "plan ready" just after), and was run again from zero: attempt 2 took 6.3 minutes and paid for the same ~4,600-token call to the strongest model a second time. 16 of the 17 planning minutes, 10 of them wasted. One planning pass is ~6 minutes (the plan call, then the design agent's own loop); a larger app would pass the 10-minute limit on every attempt and never finish.

**Built**
- `packages/agent-runtime/src/step-memo.ts`: a step's finished result is saved under `<build>/.nexsidi/step-results/`, keyed by an exact hash of its inputs, and a retry with the same inputs reuses it. Different inputs (a rejection note, a changed spec) always run the step again; a step that throws saves nothing; written whole then moved into place.
- Used for Saanvi's spec and Arjun's plan. A reused plan writes its plan files again, as a run would.
- Planning steps (spec, plan) moved off the 10-minute limit to a 45-minute ceiling; the 3-minute heartbeat still catches a dead worker.

**Not changed, on purpose:** a failed review is always run again (Amit's decision of 4 Oct: a failed review is not repeatable), so only passing reviews are reused, as before.

**Not yet proven live:** the reuse only shows when a planning step is actually retried; unit tests cover it (5 pass) and 150 tests across the activities, workflow and planner pass.

**Still to do (a separate plan for approval):** run the design brief at the same time as the plan call (it needs only the spec), and plan large apps phase by phase.

### Fixed: the deploy step was killed by a 2-hour clock (2026-10-22, batch 7)

**Found:** the Trailhead rerun's deploy step (deploy, live review, fix, redeploy; up to three rounds of ~35-40 minutes) was killed by its fixed 2-hour `startToCloseTimeout` during round 3, after that redeploy's checks had all passed (sign-in, 2 sample bookings, 34 page visits, cleanup). The build ended as `deploy_activity_error`; claim 2 could not be shown. Round 2's three findings were the reviewers' own tools failing to submit, settled not true. Claims 1, 3-10 were shown by the evidence file; the hash chain re-check was VALID over 8 records.

**Changed:** the deploy step and the pre-deploy review loop (same 2-hour clock) now have a 6-hour ceiling; both report progress every 30 seconds, so the 3-minute heartbeat still catches a dead worker, and the cost and progress guards still stop spending that goes nowhere.

**Not done:** a passing live round is not yet saved for reuse by a retry (the round that was killed had not finished, so it would not have helped this time). The reviewers' tools sometimes end without submitting findings, which costs a round; not investigated yet.

**Decision (Amit, 2026-10-22):** fix first, then retry the rerun with the spend cap raised from $30 to $40.

### Fixed: one malformed tool call ended a 98-minute deploy step (2026-10-22, batch 8)

**Found:** on the deploy retry the app was redeployed and passed its checks (sign-in, 2 sample bookings, 34 page visits, cleanup) after a live fix round; then the final reviewer called `db_query` with no query. `isReadOnlyQuery` ran `undefined.trim()`, the error escaped the agent loop (its tool dispatch had no catch) and the whole deploy step failed after 98 minutes (`TypeError: undefined is not an object (evaluating 'raw.trim')`, `deploy_activity_error`).

**Fixed:** `db_query` with a missing or non-text query is a clean error result. Both agent loops (`gemini-loop.ts`, `loop.ts`) now catch any error thrown inside a tool at the dispatch and hand it to the agent as an error result, so the step goes on. Checked first: no tool throws on purpose to stop a step (the spend cap and time limits are checked outside the tools). 721 agent-runtime tests pass; type check clean.

### Measured cost of the Trailhead rerun, and the one-pass review (2026-10-22, batch 9)

**Measured (1,370 model calls in the worker logs, priced with the platform's own rate table): $36.94.** Frontend builder $9.01 (330 calls, 15.2M input tokens); security reviewer $6.57 (161 calls, 10.7M); performance reviewer $5.57 (174, 12.7M); logic reviewer $4.75 (162, 8.0M); backend builder $4.51 (170, 8.4M); live browser review and verdict $5.52; everything else ~$1. The three code reviewers were 46% of the cost. The app they read is 53 files, 130,580 characters (~37K tokens). The database keeps only a total per project, so this had to be rebuilt from logs.

**Why:** each reviewer read the app one 8,000-character piece at a time, ~160 calls, and every call resent the whole conversation. Builders loop the same way (each step resends ~45K tokens).

**Built:** the code goes into the reviewer's first message (`buildPreloadedCode`, up to 600,000 characters, ~170K tokens; files past the budget are listed and read with tools); every included file counts as read; the step budget is 8 when everything fits.

**Amit's rule (2026-10-22):** after any fix the review covers the WHOLE app, never only the changed files, because one changed function can break every page that imports it. The changed-files-only re-review is no longer used (`changedFilesSinceLastRound` is ignored). Passing reviews are still reused only for byte-identical code.

**Proof on the real app:** one logic review of Trailhead: 2 model calls, ~119K input tokens (~$0.15) instead of ~160 calls and ~8M tokens; it found one real HIGH bug (the booking page drops the gear and dates passed from a gear page). 725 agent-runtime tests pass.

**Found, not yet fixed:** that review still took 525 s for its 2 calls. Small calls to both models answer in 2-5 s (probe), so the time is in large or failing calls under load, and nothing recorded which: there was no per-call duration or failure reason. Every model attempt now logs its model, seconds and outcome (`[call-time:<tier>] <agent> <model> ok in Xs` or `FAILED in Xs: <reason>`), so the next build shows where the time goes.

### Added: findings that ask for unrequested endpoints are dropped before routing (2026-10-22, batch 10)

The live reviewer repeatedly asked for booking cancellation and `GET /api/v1/auth/me`, which nobody requested; each went to a builder and was settled "not true" only after costing a round. `pipeline/orchestrator/out-of-scope.ts` now drops, in the live retest's guard and before routing, a finding that says something is missing and names an endpoint outside the approved API contract that no page calls. A missing endpoint a page does call is a real broken call and stays; an approved endpoint reported missing stays. On the rerun's 6 real disputed findings it drops the two unrequested ones and keeps the rest. Known limit: a finding about a new method on a path pages already use (e.g. DELETE on `/api/v1/bookings/:id` when pages GET and POST that path) is kept and left to the dispute settler, because page code does not show which method a call uses. 6 tests; 585 orchestrator tests pass.

### Added: cost per agent recorded on every model call (2026-10-22, batch 11)

`token_spend` keeps one total per project, so the rerun's breakdown had to be rebuilt from logs. New table `agent_spend` (migration 0015, expand-only: project, agent, model, calls, tokens in/out, cached, cost) is added to on every model call by all four agent loops, in the same `recordSpend` call as the project total; a failure on the agent row never loses the total. `bun --env-file=.env scripts/spend-report.ts <project>` prints the table. Proof on the real database: two recorded calls produced one agent row whose cost equals the project total ($0.0486); test rows removed. 729 agent-runtime tests pass. Applies to builds after the worker restart; the running Trailhead build's calls are in the total only.

### Google flagged the project; the security reviewer's wording made defensive review read like attack tooling (2026-10-23)

**What happened:** from the evening of 2026-10-22 every Gemini request on project `yug-ai-512316` (all six models, even a one-word ping) returns 403 "Request rejected in accordance with our terms of use and policies". The console shows "A potential violation of our Acceptable Use Policy has been detected": the project is using Agent Platform (Vertex) "in a manner that violates" the Service Specific Terms, with an appeal form. Amit is submitting the appeal. Decision: do not move to another Google project to get around it.

**Likely contributors (our reading, not Google's statement):** the security reviewer's instructions said "You attack the code", "show the actual attack", "attack vector, what the attacker gains" and asked for "a concrete exploit request"; the training module plants SQL-injection-style bugs in copies of our own code; one build sends ~1,400 automated calls.

**Changed:** the reviewer's instructions now describe what it is — an independent, skeptical, defensive code review of code the platform generated, so weaknesses are fixed before delivery — with the same OWASP Top 10 scope, severities and evidence rules (trace the data flow from the request to the weak point; file, line, how untrusted input reaches the weakness, impact if not fixed). Also reworded: the security-review skill, the logic reviewer's scope line, the QA gate tool description. A test keeps attack wording out of these instructions (code comments excluded). 887 tests pass across agent-runtime, reviewers and Tilotma.

**Still open, found the same day:** a 403 terms-of-use rejection is handled as quota exhaustion (the build waits up to 2 hours polling); the test-data cleanup misses addresses the evaluator invents (`.test` domains, made-up `.com` addresses).

### Added: the security reviewer runs on NVIDIA, never on Gemini (2026-10-23, batch 12)

**Decision (Amit, 2026-10-23):** the work most likely to read like misuse to Google's classifier (the security review, and training that plants bugs in copies of our own code) runs on NVIDIA's hosted models; everything else stays on Gemini.

**Measured before choosing:** on a small tool-call task, NVIDIA `meta/muse-glimmer-30b` 12.3 s and `nvidia/nemotron-3-ultra-550b-a55b` 12.7 s, both a correct tool call; local `qwen2.5-coder:7b` 85.6 s, no tool call and empty text. No local model is used.

**Built:** `packages/llm-client/src/nim-only.ts`. `NIM_ONLY_AGENTS` (default `karan`; comma-separated; empty = none) sends those agents to the NVIDIA chain (muse-glimmer, then nemotron) from both router entry points (`routeToolsWithFallback` for tool loops, `agentChat` for plain chat, which the training script uses) before any Gemini path, and never falls back to Gemini. The agent loops are unchanged: the conversation is translated to NVIDIA's format and the answer back (thought parts and images are not sent). Each call logs `[call-time:nim-only]`.

**Proof:** the real security reviewer on the real Trailhead app, with Gemini blocked: one NVIDIA call, 107 s, 4 findings. Checked by hand: the login cookie is set by JavaScript without HttpOnly/Secure/SameSite (real, HIGH); three "hard-coded secrets" findings in the builder's local `backend/docker-compose.yml` are one issue reported three times and rated CRITICAL for a local development file (judgment weaker than Gemini's: duplicates, inflated severity). 118 llm-client tests pass; type check clean.

**Not covered by default:** training rounds for the logic and performance reviewers also plant bugs; add them to `NIM_ONLY_AGENTS` (`karan,navya,deepika`) to keep those off Gemini too. The new project `ai-ns-yug`: its key authenticates, but the Agent Platform API is not enabled there (SERVICE_DISABLED); not switched to.
- **Same day, changed (Amit):** the reviews are too important to move to a weaker model (the NVIDIA review triple-counted one issue and inflated its severity), so `NIM_ONLY_AGENTS` now defaults to none and every reviewer stays on Gemini. The setting remains for work that should be kept off Gemini. The defensive wording of the security reviewer is what addresses the policy flag for reviews.

### Fixed: a provider refusal is never retried; test data from the live review is always cleaned (2026-10-23, batch 13)

**Refusal handling (Amit: "be careful that the system does not send anything to Gemini that blocks access again").** On 2026-10-22 Google answered 403 "Request rejected in accordance with our terms of use and policies"; the router then resent the same request to every other model in the pool, the loop called it quota exhaustion, and the build re-checked for up to 2 hours. Now (`packages/llm-client/src/provider-refusal.ts`) a terms-of-use refusal stops the call at once in both router paths (tool loops and plain chat): the refused request is sent to no other model, nothing retries it, and the error says the provider refused it. `isQuotaExhaustionError` never counts a refusal, so no step waits on one. Other 403s (an API not enabled) are not treated as refusals. Together with the defensive reviewer wording (batch of 2026-10-23) and not running the bug-planting training rounds, this is what keeps the system from repeating what was flagged.

**Cleanup.** The live evaluator signed up as `newuser9988@outdoorcamp.test` and sent the contact form as `alex@trailtest.com`; the example.com-only cleanup left both and the deploy failed its cleanliness check. Now: accounts on any reserved test domain are removed (example.com/.net/.org, `.test`, `.example`, `.invalid`, `.localhost`; never a real address); in public-form tables every row made during the testing window is removed whatever its address (the app listens only on this machine while it is tested; rows from before the window are never touched); every live review is told to use `@example.com` for anything it types into the app, with or without a ready account. Proof on the real Trailhead database: the `.test` account and all 6 test contact rows removed, the 9 gear rows untouched.

Tests: 1,633 pass across llm-client, agent-runtime, Riya, Tilotma and the orchestrator; type checks clean.

### Fixed: a model that hangs is skipped for 10 minutes (2026-10-23, batch 14, from the Brewline test build)

Measured with the per-call log in the first 30 minutes of the Brewline build (project `ai-ns-yug`): gemini-3.1-pro 68 calls ok (avg 17.6 s), 5 failed (2 timeouts, 3 "404 Publisher model not found" from the backup region), 4.2 min lost; gemini-3.5-flash 52 ok (avg 15.4 s), none failed; gemini-3.8-flash 0 ok, 4 failed, every one a 120 s timeout, 8.0 min lost. It stayed first in line because only a rate-limit error (20 s) put a model on cooldown. A timeout now puts the model on a 10-minute cooldown, then it is tried again. 122 llm-client tests pass. Applies from the next worker restart (not during the running build).

**Seen, not fixed yet:** 3.1-pro answers 404 when a call is retried in the backup region (asia-southeast1), where that model is not published; the location fallback should skip models that region does not offer.

### Fixed: the spend cap did not stop spending (2026-10-23, batch 15, from the Brewline test build)

**Found:** with a $10 cap the build spent $13.61 before I stopped the worker by hand. The cap was checked only when a step started (`assertWithinBudget`); the review-and-fix step started at $8.31 and ran its rounds inside the same step ($11.02, $13.22). A cap that is checked only at step boundaries is not a cap.

**Fixed:** every agent loop (tool loop, NIM loop, reviewer loop) checks the cap before each model call and stops with `budget_exceeded` instead of calling; the review-and-fix loop and the live loop check it before each round; the review step and the deploy step raise the existing budget stop after their rounds, so the build pauses for the owner's decision and nothing retries. A failed read of the spend never stops a build (the step-start check still applies).

**Proof (no model cost):** a real reviewer started on the Brewline project ($13.61 spent) with the cap at $10 stopped before its first model call; spend stayed at $13.61. 1,435 tests pass; type check clean.

**Also measured on this build:** the one-pass reviewers cost $0.08-0.23 each, $0.47 for all three per round (the Trailhead rerun's three reviewers cost $16.89); the builders' fix rounds are now the main cost (~$2.50 per round), findings went 16 → 8 → 2 in three rounds.

**Decision (Amit):** resume the Brewline build with a $20 cap.

### Fixed: builders read and act one step per model call (2026-10-23, batch 16, from the Brewline test build)

**Found (counted from the Brewline log):** the frontend builder made 317 model calls, every one with exactly one tool call; 131 of them read a single file. Builders had no batch-read tool (only the reviewers had their code preloaded), and every model call resends the whole conversation, so input reached 19M tokens for that one builder. Reviewers already work in one pass (all code in the first message); builders did not.

**Fixed:**
- `read_files` tool: up to 40 files in one call; a missing file is reported without failing the rest. Handled in both agent loops.
- Own-files preload (`packages/agent-runtime/src/builder-preload.ts`): when a builder works on files that already exist (every phase after the first, and every fix round) those files go whole into its first message, up to 300k characters (`BUILDER_PRELOAD_CHARS`); files past the budget are listed for `read_files`. Dependencies, build output, lockfiles and logs are skipped. The first message is also the stable start of the conversation, which is what the provider's prompt cache rewards. Kept out of skill selection so the code does not steer which skills load.
- Both builder skills now say: group independent actions in one reply (one `read_files` for every path needed, all independent writes together, one build check after a group of writes).

**Measured on the Brewline files:** the frontend preload is 58 files / 219k characters (fits the budget), the backend 16 files / 31k.

**Research the same day (how other agents keep cost down):** Claude Code keeps a fixed prefix and treats cache misses as incidents; Codex runs independent tool calls in parallel and edits with patches; Aider sends a repository map and search/replace edits instead of whole files; OpenHands/SWE-agent research found that hiding old tool output works as well as summarising it; Gemini's implicit cache needs the same prefix first and at least 4,096 tokens on 3.x models.

Tests: 1,877 pass (agent-runtime, both builders, orchestrator, Riya, Tilotma, llm-client); type checks clean. Applies from the next worker restart.

**Integration test added (same day):** `builder-batching.integration.test.ts` runs the real builder loop with only the model replaced and checks what the model is sent: with the preload on, the first message carries the builder's own files and no dependency code; with it off, nothing is preloaded; one `read_files` call returns several files (and names the missing one) in a single turn. Checked that it catches a regression: with the preload and `read_files` handling switched off, 2 of its 3 tests fail. All 1,877 tests pass together.

### Fixed: a checker's sub-check could change the app; the review had no staff account (2026-10-24, batch 17, from the Brewline resume)

**Found (live review of the Brewline resume, build held by me):** the app has staff-only pages, but the review stage made only an ordinary account (and seeded no sample data: customers cannot add menu items, so no order could be made either). The reality checker, which runs read-only, spent about 20 calls and 4 sub-checks hunting for a staff login, then started a sub-check that wrote a script and overwrote the real staff account's password in the app's database. Two system faults: (1) a sub-check did not inherit its parent's read-only limits in either agent loop, so it got write and command tools; (2) the review gave no account for a limited role.

**Fixed:**
- A sub-check runs under the same limits as the agent that started it (read-only, read-only folders, the one writable file), in both agent loops.
- The review stage reads the limited roles from the contract ("(staff only)", "admin-only"; "owner"/"authenticated" are not roles), creates one account per role on the reserved test domain, gives it its role in the app's database between sign-up and sign-in (only for test-domain addresses and plain role names), and hands all of them to the checkers.
- Sample data is created by an account allowed to create each record: the ordinary account, then each role account, then the ordinary account again; only what no account could create is reported.
- The checkers are told never to change any account's password or role, never to create accounts in the database and never to read passwords out of code, logs or the database; a page that needs a missing account is reported as not checked.

**Proof:** the new tests failed before the fix (the sub-check wrote its file) and pass after. Live on the Brewline app: the contract gives the role `staff`; the staff test account got 200 from the staff-only orders list, an ordinary test account 403; the cleanup then removed every test account (6, including 4 left by the interrupted review), 0 left. 1,885 tests pass; type checks clean (Riya's existing rootDir notice unchanged).

**Not fixed by the system (needs the owner):** the Brewline staff account's password was changed by that sub-check before the hold.

### Brewline resume result and fix: sample records without an owner were left behind (2026-10-24, batch 18)

**Run (cap $28, owner's decision; staff password reset first at the owner's request):** the role-account fix worked live — the staff test account was made, 2 menu items were seeded with it, and the reality checker tested the staff flows with that account instead of hunting for a login; no checker wrote anything. The first live round found 5 issues; the frontend builder fixed them in 23 steps, reading about 10 files in 3 batched calls (2 single reads), but still making one edit per model call (9 edits). The second live round found new issues (a footer image path that 404s, duplicate menu items, no rate limit on sign-in, open CORS, order status can move backwards). The cap stopped the build at $28.11 during the second fix; not delivered. This resume cost $5.94: two live review rounds about $2.50 each, the builder fix under $1 — the live review is now the main cost, not the builders.

**Found:** the "duplicate menu items" were the review's own sample data: menu items have no owner, so the cleanup (test accounts and everything pointing at them) left them — 4 sample rows in the delivered database.

**Fixed:** every sample record the seeder creates is written to `.nexsidi/seeded-records.json` in the build folder, across rounds; the cleanup removes exactly those rows in any table with an id column, with what points at them, and clears the list only when every removal succeeded. Only plain ids are used in the SQL.

**Proof:** tests first (3 new); live on Brewline the 4 leftover sample rows were recorded and the cleanup removed them; 1 real menu item untouched. 1,888 tests pass; type check clean.

**Next:** an edit tool that applies several edits in one call; the browser checker still takes one action per model call.

### Fixed: builders made one edit per model call (2026-10-24, batch 19)

**Found (Brewline resume fix round):** reads were batched (about 10 files in 3 calls) but the builder still made 9 edits in 9 model calls. The skill rule alone did not change that; the tool set had no way to send several edits at once.

**Fixed:** `edit_files` applies up to 40 edits, in any files, in one call. Each edit follows edit_file's rule (old_str must match exactly once); a failed edit is reported with the start of its old_str and the others still apply. It counts as a write for the step budget and the files-written list, is blocked for read-only agents, and is handled in all three agent loops. Both builder skills now say to put every independent change in one edit_files call. Also found and fixed: the Claude loop had no `read_files` handler from batch 16.

**Proof:** 4 new tests, one running the real builder loop with a fake model: both edits applied in the first call. With the loop's handler switched off, 2 of them fail. 1,892 tests pass; type checks clean.

**Also found while checking the second live round:** 3 of its 5 findings contradict the code (rate limiting exists in `auth.routes.ts`; CORS is limited to the frontend origin in `app.ts`; the cited `orders.ts` lines and status list do not exist) and a fourth was the review's own leftover sample data (fixed in batch 18). The live stage has no check that a finding's cited file and code exist (the only filter handles import claims, in the code review only), so false findings go straight to a paid fix round.

### Fixed: false alarms reach builders (2026-10-24, batch 20, from docs/root-cause/2026-10-24-brewline.md)

**Found:** of Brewline's 53 findings 30% were outside the approved plan, 6% contradicted the code and 23% came from the system itself; the live reviewers were told to "List AT LEAST 3-5 concrete issues" (every live round reported exactly 5) and to "Default to NEEDS WORK"; nothing checked a live finding against the code; the Chief AI looked at a finding only when a builder disputed it.

**Fixed:**
- **Proof gate** (`pipeline/orchestrator/finding-proof.ts`, no model call): a finding is flagged when the project proves part of it false and nothing in it checks out — it quotes code that is in no project file, every source file it cites is missing, or every API path it names is outside the contract and never called by the app. Quotes written as absences, conditions, suggestions, examples, response bodies, URLs, paths, settings values and shortened code are not checked.
- **Chief AI check** (`pipeline/orchestrator/chief-check.ts`): one call per round, no tools, sees the approved plan items (success criteria, contract endpoints, roles, approved design, an 8-rule security baseline), every model-written finding with the gate's flag, and the real code of the cited files; answers fix (with the plan item, restated with the real code) / later (`later.jsonl`, handed to the owner) / false (`settled-not-true.jsonl`, so a repeat is dropped). Machine findings skip it. If the call fails, every finding is kept.
- **Reviewer instructions:** the quota and "default to NEEDS WORK" are gone; the live reviewers and the three code reviewers get the approved plan and must start each finding with the item it breaks; zero findings is a valid answer.
- **Reviewer failures** in the live stage are no longer app findings: the review alone is run again once (no fix, no redeploy).
- **Dead-button check** no longer flags an always-disabled button ("Sold out"); a conditionally disabled one with no handler still counts.
- **CRUD check** tries the contract's own roles (a test account given the role before sign-in) after the admin route, and reports what it still cannot do as not checked instead of "every resource confirmed".

**Proof (no model cost):** replayed against the exact code each round reviewed (the build folders' own git snapshots): 0 of 84 findings flagged across Trailhead (both builds) and Ledgerly; Brewline round 11 — all 5 flagged (4 false, 1 with false details); round 10 — the 4 real findings kept, the 1 that misquoted the header flagged (its true half goes to the Chief AI with the real code). 30 new tests; 861 pass across pipeline and Riya; type checks clean.

### Fixed: the approved design never reached the builders (2026-10-24, batch 21)

**Found (Brewline):** the design agent's first answer was the café brief; the builders' completion gate ("no verification evidence this run") rejected it twice; it rewrote the answer as prose, the parser could not read it, and the system silently used the fixed fallback ("a technical product", green, Inter). The approval page showed that fallback as the design while the spec text said oat cream #FAF6F0, Fraunces; the site rendered the library's purple, and the live colour check then cost a round.

**Fixed:**
- `skipEvidenceGate` on the agent config, honoured by all three agent loops; the design agent sets it (its answer is the brief, which is validated). Builders are unchanged.
- A brief handed back as a JSON object is read.
- No silent fallback: with no valid brief, the brief is built from the approved spec's own design text (colours with their names in the spec's order, display/body fonts, mood, layout); only a spec with no colours gets the fixed fallback.
- Colours the spec names are always in the brief, first, even when the designer's brief left them out.
- The brief records its source; the approval page and the exported plan say when it came from the spec or is the fallback.

**Proof:** 5 new design tests (Brewline's real spec text gives exactly #FAF6F0, #F3ECE1, #2C1E18, #C87D55, #D46A4E with their names), 2 loop tests through the real agent loop (with the flag the brief is accepted on the first call; without it the rule still applies), 1 approval-page test. Not checked on screen: the approval page needs a build paused at approval.

### Faster: builders stop waiting for each other; fewer lost model calls (2026-10-24, batch 22)

**Found (Brewline, measured):** the backend builder sat idle 54 of 86 minutes waiting at phase ends for the frontend builder; 36 calls failed with 404 because after a 429 the router retried in a backup region that does not publish 3.1-pro, 3.6-flash or 3.8-flash (13 min); 43 calls died at the fixed 120 s limit (86 min) — successful review calls had a median of 42.6 s, p90 102 s and a slowest of 119.1 s, so the limit cut off calls that needed a little longer; the three reviewers all started on the same model.

**Fixed:**
- **Phases** (`runBuildPhases` in the workflow, behind `patched("independent-build-phases-v1")` so running builds keep the old order): each builder runs its own phases straight through. The backend's phase 2 still waits for the database step and the frontend's last phase (the only one with the whole-app browser check) waits for the finished backend.
- **Backup region:** a 404 there is remembered per model; the same request is retried on the primary with backoff (Google's guidance for a 429), so the call is not lost, and that model is not sent to that region again.
- **Timeout by size:** about 1.8 s per 1,000 tokens sent, never under 120 s, at most 6 minutes — a builder call (~60k tokens) keeps 120 s, the one-pass review (~150k tokens) gets 270 s.
- **Separate first models for parallel reviewers** (Amit's request): logic review starts on the review tier's 1st model, security on the 2nd, performance on the 3rd; every model stays as a fallback.

**Not changed (Amit's decision, 2026-09-28):** the builder tier still starts on gemini-3.8-flash. Measured on Brewline: 3.5-flash 98% of calls ok (median 6.8 s), 3.6-flash 95% (5.6 s; its failures were the backup-region 404s fixed above), 3.8-flash 73% (20.3 s), 3.7-flash 75% (30.1 s), 3.1-pro 78% (9.6 s), argon 96% (14.9 s).

**Proof:** phase-order tests with fake builders (the frontend reaches phase 3 before the backend finishes phase 2; its last phase starts after the backend's; the backend's phase 2 after the database); backup-region tests (the 404 call succeeds on the primary, the region is skipped next time; a model the region has still falls over); timeout values; reviewer first models. 127 llm-client and 41 workflow tests pass; type checks clean.

### Each builder checks its own work; fewer model-driven checks (2026-10-24, batch 23)

**Found (7 builds measured):** 28–73% of builder model calls were step-by-step checks (start containers, call an endpoint, click a page — one action per call), and the backend builder had to prove live HTTP checks in every phase. Meanwhile cheap checks that would have caught 8 of Brewline's findings (emoji) and its colour findings ran only in the review, after the builder said "done".

**Fixed:**
- `exitChecks` on the agent config, honoured by all three agent loops: when the agent calls task_complete the system runs them, and what they find goes back to the agent to fix before it may finish.
- The frontend builder uses it in its last phase and every fix round: emoji in the UI, dead buttons, and every colour the approved spec names present in the frontend (`pipeline/orchestrator/stages/builder-exit-checks.ts`). Pure file reads, no model call.
- The backend builder's middle phases need a passing type check and build; the live per-endpoint check runs once, in its last phase (as the frontend builder already did). The phase text says so.
- The phase-order test was rewritten without timing (explicit hand-offs), so it is exact under load.

**Proof:** check tests on fixture projects (emoji, a dead button and a missing spec colour are reported; a clean frontend and a spec without colours pass); a loop test (finishing refused once while a problem is open, then allowed); wiring checks. 2,160 tests pass across agent-runtime, agents, pipeline and llm-client; type checks clean. One older stage-5 timing test failed once under full load and passes alone (not touched here).

### Redeploys without the deploy agent; the app keeps its secret (2026-10-24, batch 24)

**Found (Brewline):** every redeploy after a fix round ran the deploy agent again (11–19 model calls re-reading the same Dockerfiles and compose file) and every deploy generated a NEW JWT secret that the agent wrote into the compose file — the value is in Brewline's log six times, and on a real app a new secret signs every user out.

**Fixed:** an app that already has a secret keeps it; a running app is rebuilt by the system (`docker compose up -d --build`, then `/health` and the frontend must answer); the agent runs only if that fails, or for a first deploy. The deterministic database, round-trip and CRUD checks after it are unchanged.

**Proof:** 4 tests (secret read and kept; rebuild and health check without the agent; a failed build or an app that does not answer is reported with the reason so the agent takes over; wiring). Live on Brewline: redeployed by the system in 104 s with no model call, menu API 200. Brewline's later agent redeploys took 1.7–3.5 min, so the time gain is modest (the docker build dominates); the gain is the model calls and the secret.

### Builder teams, team fix rounds and parallel review collectors (2026-10-24, batch 25)

**Asked (Amit):** builders split their own work across helpers like Claude does, finish faster, test their work, and follow the approved plan; the same in the review if possible; builders on flash models, the pro model for complex work; bring build and review time down without idle time or wasted calls.

**Found:** the existing `spawn_subagent` tool was never used by a builder in four builds; a helper got 12,910 characters of instructions against Aanya's 56,431 and no plan, contract or design; several tool calls in one reply run one after another, so two helpers would not overlap. The plan already gives every task its own files with no overlap; the plan's phases limited parallelism (Brewline's backend had one task in each of phases 2 and 4).

**Built:**
- **One team pass per builder** (`pipeline/activities/build-phases.ts`): the plan's phases collapse into one pass (decided once per build in `getBuildPhaseCount` and recorded in `team-pass.json`, so builds already running keep their phases). On the first build the lead (3.1-pro) writes the shared files and the foundation tasks (app setup, middleware, root layout, API client, database connection); up to 3 helpers build the rest at the same time; the lead integrates, compares the code to the plan and runs the full checks once. A failed helper is retried once, then its tasks go to the lead. The backend waits for the database step before it starts.
- **Helper limits** (`packages/agent-runtime/src/team-files.ts`): a helper writes only its tasks' files, new files in their folders and tests beside them; type check only; no build, containers, browser, whole-folder rollback or nested sub-agents (a new per-run tool block, honoured by all three loops); flash tier, helper N starting on the Nth model. Backend helpers write node:test unit tests; the lead's finish check runs the compiled tests, checks every task file exists and keeps the phase's own checks.
- **Fix rounds as a team** (`pipeline/orchestrator/team-fix.ts`): with 3+ findings in 2+ files, findings are grouped by file; up to 3 helpers fix their own files at the same time, then the lead handles findings without a file and anything a helper could not finish, checks the helpers' fixes and runs the full checks once. Used by both review stages.
- **Builder models:** the builder tier keeps all four flash models, ordered by Brewline's measurements (3.5, 3.6, 3.8, 3.7); parallel helpers each start on a different one. Lead steps use the design tier (3.1-pro first).
- **Review collectors** (`agents/tilotma/src/tier3-review.ts`): up to 3 evidence collectors at the same time, each on its share of the approved plan's success criteria, in its own browser, first model and screenshot folder; the first also covers landing, sign-up and sign-in; findings merged, then the reality checker as before.
- **Repaired on the way:** an earlier Perl edit had double-encoded every non-ASCII character in `loop.ts` (101 dashes); found by a failing test, repaired byte-exactly, all changed files scanned clean.

**Proof:** team runner tests (shared files first; three helpers overlapped; lead after all; failed helper retried then handed to the lead; foundation tasks to the lead; single-task and teams-off paths unchanged), write-rule tests, a rollback refused through the real loop, fix-team tests, review split/merge tests, model order tests. Brewline's real plan: frontend split into 3 helpers, backend foundation to the lead and 3 endpoint helpers, review criteria 3/3/2. 2,306 tests pass; type checks clean. **Not measured yet:** the time and cost effect needs a paid build.

## Batch 26 — no hot-linked images, honest hold-page wording (2026-10-24)

**Found:** generated apps hot-linked stock photos (Trailhead: a burger photo stood in for a sleeping bag; the browser blocked others). Two hold-page reasons guessed at the cause ("often a transient network issue").

**Built:**
- **Image check at the builder's "done"** (`pipeline/orchestrator/stages/builder-exit-checks.ts`): `externalImageUrls` finds http(s) image URLs and stock or placeholder hosts in source and seed files (embedded images and app paths are not reported). The frontend builder's checks include it; a new `backendExitChecks` scans the backend code and the database files, run by the system when the backend builder finishes (last phase, team lead, fix rounds). Both builders' instructions carry the rule.
- **Hold-page wording** (`apps/web/components/ide/IdeWorkspace.tsx`): the reasons say what happened and what Retry does, with no guesses; a test fails on guessing words.

**Proof:** exit-check tests (6 pass) and the hold-page test (7 pass); builder, stage and runtime suites 1,176 pass, 0 fail. **Not measured yet:** effect on a real build.

## Batch 27 — reviewer requests that the cache can reuse (2026-10-24)

**Found (measured on Brewline's real files):** reviewers got 24-28% of their input from the model's cache, which reuses a request only up to its first changed character. (1) The code went in path order; Brewline's last fix changed `backend/src/app.ts`, the first file, so 0.4% of the 198K-character code block stayed identical. (2) The security and performance scan results, which change every round, came before the code. (3) A reviewer's skills were matched against the whole message, code included, so a code change could change its instructions, the very start of every request; on Brewline this also pulled the India-currency and invoice-numbering guides into the logic review of a US-dollar coffee shop.

**Built** (`packages/agent-runtime/src/qa-loop.ts`, `pipeline/orchestrator/stages/stage5-adversarial-qa.ts`): least recently changed files first (74.8% of the code block identical on the same round); this round's scan results after the code (`joinRoundNotes` / `splitRoundNotes`); skills matched on the reviewer's focus and the build's stable context only (`qaSkillMatchText`). Same review content: every file is still included and reviewed.

**Proof:** 8 reviewer-message tests (order, scan results after the code, two rounds sharing everything before the fixed file, skill text without code or scan results); runtime, orchestrator and reviewer suites 1,483 pass. Skills on Brewline's plan: logic money-exact, review-money-logic, data-isolation; security unchanged; performance unchanged. **Not measured yet:** the cache rate on a real build.

## Batch 28 — several browser actions in one call (2026-10-24)

**Found:** on Brewline the live reviewers drove the app one browser action per model call (~16 min a round), each call resending the whole conversation.

**Built:** `browser_steps` (`packages/agent-runtime/src/tools/browser.ts`): a list of up to 20 browser actions (navigate, click, fill, screenshot, get_text, console_errors, computed_style, element_exists, current_url) runs in one call, in order, on the same page; every result comes back together, every screenshot is attached (both loops, `screenshotImagePathsFor`), and it stops at the first failed step and names it. Each action keeps its own checks (localhost only, screenshot path inside the evidence folder). The live reviewers' instructions (`agents/tilotma/src/tier3-review.ts`) start every page with one such call and group every action whose input they already know.

**Proof:** browser tests (order, results and screenshot returned, stop at the failed step keeping earlier screenshots, refusals: empty, over 20, unknown action, outside URL), image-attachment test; live on Brewline in a real browser: 7 actions in one call in 9.95 s, screenshot saved and checked. All suites 2,415 pass. **Not measured yet:** the round time on a real build.

## Batch 29 — the footer logo is a file, not retyped (2026-10-24)

**Found** (from the screenshot above): Brewline's footer showed a broken YugNex logo. The builder's instructions held the logo as a 5,432-character encoded image to copy exactly; Brewline's copy differs from character 370, and 2 of the 10 builds on disk have a wrong copy. My earlier "logo fixed" was wrong: I had checked the code, not the rendered page.

**Built:** the frontend scaffold writes `public/yugnex-logo.png` (byte-identical to `packages/agent-runtime/assets/yugnex-logo.png`) into every app; the builder writes only `<img src="/yugnex-logo.png" ...>`; the encoded image is gone from the instructions (5.4K characters less in every frontend call). The builder's done-check reports a YugNex logo that does not use the file, or a missing file.

**Proof:** scaffold test (file written, identical bytes, called by the scaffold; instructions contain the path and no encoded image), exit-check tests (embedded copy reported, missing file reported, correct footer passes); the check flags Brewline's real footer. All suites 2,415 pass.

## Batch 30 — the page sweep reports broken images (2026-10-24)

**Found:** Brewline's broken footer logo was reported by a reviewer with a cause that was not in the code, so the proof check refused it and the real broken image shipped. The system's own page sweep opens every page in a real browser but did not look at images.

**Built** (`pipeline/orchestrator/stages/route-sweep.ts`): the sweep reads every image that finished loading without a picture (`complete && naturalWidth === 0`), reports it with its alt text and the start of its address, and merges one image seen on several pages into one finding naming them (a shared header or footer). Images still loading are not reported.

**Proof:** sweep tests (finding, phone visit not double-counted, merge across pages, the page reading includes the check); live in a real browser: Brewline's logo is reported on /, /menu and /about; Trailhead 2 (valid logo) reports nothing. Root-cause doc corrected (the logo finding moved from "false" to "caused by the system").

## Batch 31 — the approved API contract checked against the compiled backend (2026-10-24)

**Found:** the plan's section 5 item 1: the contract was only a text the builders were told to follow. Nothing in the system called each endpoint and compared what the backend answered.

**Built** (`pipeline/orchestrator/stages/contract-route-check.ts`, run in its own Node process by `contract-route-runner.cjs`): when the backend builder says it is done, the system loads the compiled app (`dist/app.js`, no database) and calls every contract endpoint. It reports: a route that answers 404 (not mounted; a 404 on an `:id` route is a missing record, not reported), a protected route that does not answer 401/403 with no token, and a route the contract itself calls staff-only that a signed-in customer token can call. Not run (and says so) when the contract or build is missing or the compiled app is older than the source. Never fatal. Frontend unit tests are still not built; this item covers the backend contract only.

**Proof:** 5 tests (matching backend passes, each of the three defects found, no build = not run, wired into the builder's finish check); live on Brewline's real compiled backend: 9 endpoints, 4 staff-only, 0.8 s, no findings (its backend does match its contract). All suites pass.

## Batch 32 — public catalogs ship with starter content (2026-10-24)

**Found:** Brewline's spec says customers browse the menu of drinks and pastries, but no instruction told any builder to ship starter content: its database files hold no inserts besides the staff account, and the delivered app showed one test item left from the review. (Trailhead 2 has starter rows; it happened to be built that way.)

**Built:** rule 17 in the backend builder's instructions (a public list endpoint needs `backend/src/db/seedCatalog.ts`: 8-15 believable rows in the spec's currency, inserted at startup only when the table is empty, no image addresses); a check at the backend builder's finish (`starterContentFindings`): a public GET list in the approved contract with no INSERT into any table but users, in a seed module or migration, is reported.

**Proof:** tests (reported with no rows; a seed module or a migration satisfies it; an app with no public list is not flagged; the rule is in the instructions); on real builds: Brewline reported, Trailhead 2 passes. All suites 2,423 pass.

## Batch 33 — first deploy from a fixed template, and migrations proven on an empty database (2026-10-24)

**Found (Brewline, from its own records):** the deploy agent made 89 tool calls over 488 minutes; its first compose file already had the structure of the final one, and all 5 later edits changed only the JWT secret (fixed earlier). Starting a copy of Brewline from scratch then found a second, worse problem: `db/migrations/0003_fix.sql` (the fix round's "remove duplicate menu items" migration, for duplicates our own sample data had made) uses `MIN(id)` on a uuid column; PostgreSQL 16 has no `min(uuid)`, so on a new database Postgres stops while starting and the delivered app cannot start. The running app only worked because its database predates that file.

**Built:**
- `renderComposeFile` / `composeFromTemplate` (`agents/riya/src/index.ts`): the system writes the standard compose file (loopback-only ports, the app's secret, migrations as the init directory) for a standard app, then starts and health-checks it with the same code that redeploys a running app. The deploy agent runs only if that fails, and is then told the file is written and to change only what the logs show. Declines (agent writes it) when a Dockerfile or the migrations are missing, or the backend reads a variable the file does not set (seed-account email/password variables are optional by the backend rules).
- `migrationFindings` (`pipeline/orchestrator/stages/migration-check.ts`): applies every migration in order to an empty PostgreSQL 16 in a throwaway container, as a customer's first start does, and reports the first file that fails with line and the database's own message. Run at the backend builder's finish (`backendFreshStartFindings`). Not run, and says so, if docker is unavailable.

**Proof:** template output is byte-identical to Brewline's final compose file (apart from the secret); on a copy of Brewline the system wrote it and brought the whole stack up and healthy in 13 s (images cached; the agent's first deploy was 25 min), menu answers, frontend 200; the migration check found Brewline's `0003_fix.sql` in 7.7 s with the database's own message and passed Trailhead 2; tests for both (6 + 4); all suites 2,433 pass. Brewline itself was not changed (CLAUDE.md: fix the system, not the app); its broken migration is a finding for the next build. **Not measured yet:** the deploy time on a real first deploy.

## Batch 34 — audit of the untraced parts, and ports held per build (2026-10-25)

**Audit (item 8), from Brewline's records and the code:** planning chain consistent (spec to contract 9 of 9, schema equals migrations, every route has a task); the design-score agent is sound (scores required, unscored never passes, screenshots required) but Brewline never reached it, so no scores traced; other app types: only `web` exists; multi-user: found that ports are picked from a snapshot with no hold, and the worker runs 6 activities at once.

**Built:** `portReservations` (`agents/riya/src/index.ts`): a port a build picks is held for it for 45 minutes in a shared file in the builds folder, checked and taken in one step after the host check; a damaged file counts as empty. The design-score agent's instructions include the grouped browser call.

**Proof:** tests (two builds picking at the same moment get 3200 and 3201; own hold ignored, expired hold free; damaged file; the three picks use it); Riya suite 155 pass. **Not checked:** two real builds at the same time; the web UI screens other than the failure texts; the planner on other kinds of spec.

## Batch 35 — a reviewer that did not finish is run again, not escalated (2026-10-25)

**Found (brewline2, the first build on the new system, started from the web app):** round 1 sent one real finding to a builder; round 2 had only a notice that Karan's review "did not complete" (two of its model calls timed out at 120 s). The loop removed the notice before routing (right, no builder can fix it), found nothing routable and returned "stuck" at once, which escalated to a human (`stuck_state`) 28 minutes into a build whose real findings were all fixed. The earlier rule that reviewer failures never reach a builder worked; the missing half was running the review again.

**Built** (`pipeline/orchestrator/stages/stage5-qa-fix-loop.ts`): when the only findings left are reviewer-did-not-finish notices, the review is run again, up to 2 times; a clean re-run passes without paging anyone; a reviewer that keeps failing stops the loop with the notice still in the report (default-FAIL unchanged).

**Proof:** 2 new tests (fail, then clean: 3 reviews, one builder fix, pass, not stuck; always failing: 3 reviews, no builder asked, stuck with the notice kept); the 42 earlier loop tests still pass; all suites pass.

**Recorded for the full trace after this build, not changed:** Karan's one-pass review calls on gemini-3.8-flash and gemini-3.1-pro both aborted at the 120 s floor of the size-based timeout while gemini-3.7-flash answered in 43 s; a later gemini-3.6-flash answer ended without submitting findings.

## Batch 36 — the hold card stops guessing (2026-10-25)

**Found (brewline2):** the card shown when a build waits for a decision added its own sentence after the reason: "This is often transient (a network blip, a temporary quota limit)". It is a guess, and on that build it contradicted the reason shown just above it. My earlier test only covered the reason texts, not this second sentence.

**Changed** (`apps/web/components/ide/IdeWorkspace.tsx`): the card says what Retry does ("Retry resumes from where the build stopped; the work already done is kept"), exported as `RETRY_NOTE`; the `stuck_state` reason now names both ways the quality checks can stop (the same issues keep coming back, or a reviewer could not finish).

**Proof:** test (no guessing word in the note, the stuck reason names a reviewer, the card uses the note and not the old sentence); web suite and type check clean.

## Batch 37 — a role never comes from the request (2026-10-25)

**Found (brewline2, the first build started from the web app):** the approved spec said sign-up "creates a new customer or staff account", and the backend did exactly that: its sign-up body accepts `role: 'customer' | 'staff'`, so anyone can register as staff and reach the barista dashboard and menu manager; no staff account is seeded either (the delivered database held one customer and no staff). The code reviewers returned nothing on it (the plan appeared to allow it), and I approved the spec without flagging the wording. No instruction anywhere said a role must not come from a request.

**Built:** the planner never writes "customer or staff account" for sign-up and puts the seeded account in the spec (`saanvi.md`); backend rule 18 (a role never comes from the request; a seeded `seedStaff.ts` creates one staff account only when none exists, email and password from env, a generated password logged once); the auth skill and the security-review skill (loaded for the builders and for Karan by keyword) say the same; two checks at the backend builder's finish: `roleFromRequestFindings` (a sign-up file that reads a role from the request) and `staffAccountFindings` (a contract with staff-only endpoints and no seeded staff account).

**Proof:** tests (reported with a role field in the sign-up body; not reported for a sign-up with no role field or for reading `req.user.role`; staff-only contract with and without a seeded staff account; the rules are in the planner, builder and both skills); on real builds the checks flag Brewline 2 only and pass Brewline 1 and Trailhead 2; all suites pass. Brewline 2 itself is not patched (CLAUDE.md: fix the system, not the app).

## Batch 38 — the system's own checks wait out the app's rate limiter (2026-10-25)

**Found (brewline2):** after the second live fix the system redeployed the app and its live check registered a test account; the app's own sign-up limiter answered `429 Too many requests` (the earlier checks of the same deploy had used the window) and the whole deploy was reported failed (`deploy_failed`), escalating the build to a human. Earlier the same build had "auth smoke test skipped (the login API answered 429)": a sign-up form went unchecked. A rate limiter that works is exactly what the security rules ask the app to have; the system's checks must not treat it as a failure.

**Changed:** `postJsonWaitingOutRateLimit` (`agents/riya/src/index.ts`) for the deploy checks' test-account sign-up and sign-in, and `signInWaitingOutRateLimit` (`pipeline/orchestrator/stages/auth-smoke.ts`): a 429 is waited out for the app's Retry-After (a minute when it gives none, plus a second) and repeated, up to 3 tries; any other answer is returned at once. The review-account helper in the page sweep already did this.

**Proof:** tests (waits the stated time and repeats; no header: 61 s, 3 tries, last answer returned; other statuses at once; network errors thrown; the helper uses it for both calls; the smoke test waits and goes on); all suites pass.

## Batch 39 — the orders check finds the real menu item (2026-10-25)

**Found (brewline2):** every deploy reported "CRUD verification: not checked: orders: items.0.menu_item_id: Invalid menu_item_id format", although the app ships 12 menu items. `resolveForeignKeyId` looked for the list of a related resource at `/api/v1/menu_items` or `/api/v1/menu_item`; the contract's list is `/api/v1/menu`. The order flow, the heart of a pre-order app, was never exercised by the system's checks.

**Changed** (`agents/riya/src/index.ts`): the related list is found by the resource's own words: the name with underscores, hyphens or neither, singular or plural, and without a trailing "item"; only a list directly under `/api[/vN]/` counts.

**Proof:** tests (menu_item_id finds /api/v1/menu; gear_item_id finds /api/v1/gear-items; user_id and order_id never take another resource's list, e.g. /orders/me); on the running Brewline 2 the check now returns a real menu item id and nothing for user_id and order_id; Riya suite 162 pass, all suites pass. Takes effect on the next deploy check.

## Batch 40 — the system's checks no longer use up the app's rate limit; a round with nothing open passes (2026-10-25)

**Found (brewline2, traced in a clean browser):** the generated app limits sign-up and sign-in to 10 requests per 15 minutes per address, counted in memory. The system's own checks (deploy round trip, role accounts, auth smoke test, page sweep, live reviewers) use that budget up in every round. Results: (1) "Auth smoke test: FAILED" (the sign-in form was answering "Too many requests"; signing up and in by hand in a clean browser worked: the account lands on /order with Sign Out showing); (2) the deploy was reported failed on a 429 (fixed in batch 38 by waiting, which can stall up to 15 minutes); (3) the customer's first real sign-up right after delivery could be refused too. Separately, after Tilotma ruled the smoke finding not true before the guard, the round had no findings left but still counted as failed, so the build escalated to a human (`deploy_failed`) with nothing to fix.

**Built:**
- `resetAppRateLimits` (`pipeline/orchestrator/stages/limiter-reset.ts`): restarts the backend container of our own test instance (resets the in-memory counters; the app's limiter is not edited or switched off) and waits for `/health`. Run before the deploy's own checks (`agents/riya/src/index.ts`; a redeploy with an unchanged image keeps the old container), before a live round's account-making checks and after its test data is purged (`stage6-deployment.ts`, so the customer's first sign-up is not refused for the checks' sake). A failed reset is logged or listed as "not checked", never fatal.
- `stage6-deployment.ts`: when every finding of a live round is ruled not true before the guard and design and spec pass, the round passes (the code-review loop already did this).

**Proof:** limiter-reset tests (restart then wait; failures reported not thrown; used in both places in the right order); stage-6 test (finding returns, ruled not true, delivery passes; failed before the change exactly as on the build); on the real Brewline 2: reset in 6.1 s, then sign-up and sign-in in a clean browser both work; all suites pass.

**Not an app bug, recorded:** opening a delivered app in a browser that also holds the YugNex platform's cookie bounces /sign-in and /sign-up to /order in a loop (cookies on `localhost` are shared across ports and both use the name `token`); it froze a Chrome tab. It affects anyone who runs the platform and a delivered app in the same browser (a demo on one laptop). A unique cookie name per generated app is the fix, still to be done.

## Batch 41 — the browser review is never skipped silently; real bugs are not filed as "later"; the review gets time to finish (2026-10-25)

**Found (brewline2, traced from its records):** (1) the live browser review (Tier 3) and the design score run only when the static reviewers pass. The Chief AI sets findings aside afterwards, in stage 6, so the build passed with neither having run (no reviewer or design-score events at all), and `buildDeliverySummary` counted a missing design score as passed. (2) The reviewers did report the staff-registration hole (CRITICAL) and the cascade that deletes past orders' lines (CRITICAL); the Chief AI filed both under "later" because no plan item named them (the spec's own wording allowed a staff sign-up). Both are still in the delivered app. (3) 16 of 34 review calls were cut off at exactly 120.0 s (about 2 minutes each, then a fallback model started again); 18 finished in 21 to 104 s; alone, the same review answered in 24 to 70 s per model (probe), so these are slow answers under load.

**Built:**
- `stage5-adversarial-qa.ts`: a result says whether Tier 3 ran (`tier3Ran`). `stage6-deployment.ts`: a pass that came without it is marked `needsBrowserReview`; `runStage6` runs the browser review and the design score alone (`browserReviewOnly`: same accounts and sample data, the checks that already passed are not repeated) before accepting the pass; what it finds goes to a builder like any live finding; if it cannot run, the delivery is "not verified" and says why.
- `chief-check.ts`: the yardstick gets SEC9 (no endpoint lets a caller choose their own role) and INT1/INT2 (history survives deleting or editing what it refers to, with the price as it was; a check-then-write is one atomic step); the Chief is told a security flaw or lost history is never "later" because the plan's wording allowed it.
- Builders and finish check: backend rule 19 and a database rule (HISTORY IS KEPT: unit price copied into the line, RESTRICT not CASCADE from the catalog row, delete refuses or archives, stock check and insert in one transaction); `historyIntegrityFindings` reports a line table that cascades from its catalog row or keeps no price (skipped for a table a later ALTER touches).
- `gemini.ts`: a request of 120,000 characters or more has at least 240 s (size rule still wins when longer).
- Earlier in this batch: a time on every worker log line (`log-timestamps.ts`).

**Proof:** tests for each (Tier 3 marker; owed review runs and decides the delivery; its finding goes to a builder; cannot-run is not verified; the real wiring; the two new yardstick items and the Chief's rule; the cascade and price check; timeouts at 119,999 / 120,000 / 187,000 / 600,000 characters); the history check flags Brewline 2 (cascade and no price), Brewline 1 (no price) and passes Trailhead 2; all 2,468 tests pass, type check clean. **Not run for real:** the owed browser review on a live app, which costs a few dollars: its first real run will be in the next build.

## Batch 42 — strongest models for the reviewers, the spec itself can no longer allow a staff sign-up, alarms on the spot (2026-10-25)

**Asked (Amit, after brewline2):** why were problems not noticed and raised at once, why do the adversarial reviewers use flash models (give them the pro models), why the deploy and live checks take over an hour (time and cost optimisation), and why the wrong plan was approved.

**Measured (no model cost):** the no-model steps of a live round take about 2.5 minutes (restart 6 s, redeploy with cached images 68 s, sign-in check 28 s, page sweep 42 s), so the deploy itself is not the long part. Reviewer model time was 46.9 minutes, of which 30.0 minutes (64%) were the 15 calls that waited out the full 120 s and failed (Navya alone about 18 minutes in sequence). The rest of the 106 minutes of deploy and live checks is model work (reviewers, Chief AI, dispute settling about 9 minutes, fix agents, redeploys with changed images); its exact split was not logged (now it is).

**Built:**
- `router.ts`: the reviewers lead on the two strongest models (logic and performance on `gemini-4-argon`, security on `gemini-3.1-pro-preview`), chosen by name; the flash models are fallbacks only, 3.8-flash last (0 of 7 as a reviewer). Argon is priced at $4/M input, about the same per large review call as pro (about $0.30): expect the reviewers to cost about $1.5 to $2 more per build.
- `saanvi/src/index.ts`: a public sign-up endpoint is never specified as creating a privileged account: staff/admin wording is removed from its description and any role field from its request body before the spec is locked (the wording "customer or staff account" is what the builders followed on brewline2; I approved it without catching it, so the safeguard is now the system's).
- `watch-alarms.ts`: failure patterns of a build log (model call failed after N s, 429, escalated to a human, not checked, reviewer did not finish, live retest failed, smoke test failed, budget) raised as alarm lines the moment they are written, repeats shown once with a count.

**Proof:** tests for each; replayed on brewline2's real logs the watcher raises the 15 two-minute review failures, 9 not-checked results, 3 escalations and 4 failed smoke checks; all suites pass, type checks clean. **Not measured yet:** the time and cost effect on a real build.

## Batch 43 — a per-call ledger and a call-by-call cost and time report (2026-10-25)

**Asked (Amit):** "a fully detailed costing and timing of each agent, each round, not an overview report."

**Found:** the project's spend table (`agent_spend`) holds only totals per agent and model: no per-call times, no rounds, and several paths (the planning chat, Saanvi's research, Arjun, the Chief AI check, the design brief) were not in it at all, so the project's cost figure left them out (the cap did not count them either).

**Built:**
- `packages/llm-client/src/call-ledger.ts`: every Gemini call, answered or failed, is appended to `.call-ledger.jsonl` in the builds folder: model, start and end time, duration, tokens in and out, cache hits, error text, and the agent, tier and project it belongs to. `gemini.ts` records both call paths (`geminiChat`, `geminiChatWithTools`); the agent loops set the context (`withCallContext`); every worker activity runs inside its project's context and the planning activities name their agent (`pipeline/activity-context.ts`); the Chief AI check names itself. Under `bun test` nothing is written unless a test opts in (`.env` sets `BUILD_DIR` for every run).
- `pipeline/build-report.ts` and `build-report-cli.ts` (`bun pipeline/build-report-cli.ts <projectId> [out.md]`): the build's timeline from the workflow's own step times, each step split into one window per review round (from `rounds.jsonl`), each call assigned to the window it ended in, and per window and agent: calls answered and failed, models, tokens, cache share, cost, call time, time wasted on failed calls and first-to-last span; then every failed call with its reason, totals by agent and by model, and a reconciliation with `agent_spend`.

**Proof:** tests for the ledger (success, failure, context, concurrency, an unwritable ledger, test isolation), the activity context and the report arithmetic (windows tile the timeline, per-agent sums, totals equal the rows, unattributed and out-of-window calls kept); the report tool run on Brewline 2's real workflow history gives its exact step and round windows (no call rows: it predates the ledger); all suites pass. **First real report:** the build running now (Brewline 3).

## Batch 44 — the system keeps order history safe in the database folder, the backend builder is no longer asked to (2026-10-25)

**Found (brewline3, stopped at "generation failed"):** the history check added in batch 41 told the backend builder to change `ON DELETE CASCADE` to `RESTRICT` in `db/migrations/0000_initial.sql`. That folder belongs to the database builder and the backend builder cannot write it, so every finish attempt was refused, the team gave up after a retry and the build escalated to a human. My check was applied to the wrong owner.

**Built:**
- `builder-exit-checks.ts`: `keepHistoryInMigrations(projectDir)` rewrites, in a line table (order/invoice/booking/purchase/sale parent column plus a catalog reference), the catalog reference to `ON DELETE RESTRICT`; the reference to its own parent order keeps its cascade; a table later changed by `ALTER TABLE` is left alone; a second pass changes nothing. The history check is no longer part of the backend builder's finish gate. The `ALTER TABLE` matcher in `historyIntegrityFindings` had a lost backslash (matched the letter s); fixed.
- `shubham/src/index.ts`: the system runs the rewrite before the backend finish check (covers a build already past the database step); `pranav/src/index.ts`: and right after the migration is written for new builds.
- A missing price column is not rewritten by the system (the right column cannot be guessed); it stays with the reviewers and the Chief AI check (INT1/INT2).

**Proof:** a test that the rewrite changes only the catalog reference, keeps the parent cascade, leaves non-line tables alone, is idempotent, and that the backend finish check no longer reports it; all our suites pass (the 3 failures are in the untracked third-party `ref repo/`).

## Batch 45 — no check may ask a builder to change files it cannot write; blocked reports raise an alarm at once (2026-10-25)

**Found (brewline3 log):** the backend builder finished its real work about 10 minutes into the phase (first refused finish 11:19:09) and reported "[blocked] ... I cannot modify db/migrations" at 11:20:06; it was then refused 14 more times and the build escalated at 11:30:44. My alarm watcher only raised on the escalation, so the problem was raised 10 minutes after the builder had said it.

**Built:**
- `watch-alarms.ts`: a `[blocked]` report and a `task_complete REJECTED` line are alarms at once (repeats are counted, not flooded).
- The migration-on-an-empty-database check (`backendFreshStartFindings`) had the same flaw (it names `db/migrations` files); it moved from the backend builder's finish check to the review round (`stage5-adversarial-qa.ts`), where a `db/` finding goes to the database builder.
- `shubham/src/index.ts`: the history-key rewrite from batch 44 is now actually wired in front of the backend finish check (the earlier edit had not applied; the build was saved by the database builder's own rewrite).

**Proof:** tests for the alarms, the check moving, and the wiring of both rewrites; all our suites pass except one timing test that passes on its own (flaky under full-suite load) and 3 tests in the untracked third-party `ref repo/`.

## Batch 46 — why the builder calls were slow: the third helper started on the slowest model (2026-10-25)

**Measured (brewline3 ledger, 153 calls):** median call time on the same size of input (about 40–60K tokens in): 3.1-pro-preview 6.3 s, 3.5-flash 8.1 s, 3.6-flash 3.4 s, **3.8-flash 58.7 s** (12 calls, max 147 s). Even a 97-token answer on 3.8-flash took 75 s, so the wait is the model's queue, not the writing. Parallel helpers start on different models of the builder pool; the third started on 3.8-flash and sat about a minute per step.

**Changed:** `router.ts` builder pool is now 3.5, 3.6, 3.7, 3.8 (all four kept, 3.8 last, as a fallback); tests updated. Takes effect when the worker next restarts.

## Batch 47 — the new-database migration check never ran inside the worker (2026-10-25)

**Found (brewline3 log):** all 6 runs of the check ended with "migration check not run: spawnSync cmd.exe ETIMEDOUT", each within a second, while the same code run from a shell worked in 5 s (and found nothing wrong). So the check had never actually run in a build, and nothing raised it: the alarm watcher looked for "not checked" only.

**Changed:** `migration-check.ts` starts docker directly (no cmd.exe) and keeps the error code in the note; `watch-alarms.ts` raises "check not run" as NOT CHECKED. Proof: argument-splitting test, alarm test, and a run against brewline3's real migrations (ran, nothing found, 4 s). Whether the direct start also works inside the worker is confirmed at the next review round of this build.

## Batch 48 — a one-pass review has 6 minutes, not 4 (2026-10-25)

**Measured (brewline3 ledger):** the logic reviewer's first call (about 70K tokens in) writes 15K–25K tokens: 136 s and 238 s when it finished; cut off at exactly 240 s five times (3 of 3 on argon, 2 on pro), each a lost 4 minutes before the next model was tried (about 20 minutes wasted in 4 rounds). The performance reviewer's calls on argon write 2K–4K tokens and finished in 37–55 s.

**Changed:** `gemini.ts` large-request floor 240 s → 360 s (the existing maximum); tests updated. Takes effect at the next worker restart.

## Batch 49 — a confirmed finding goes to the owner of the file it names (2026-10-25)

**Found (brewline3, stopped "stuck" after round 5):** one finding ("order lines show the menu item's current name") cycled for 3 rounds. The backend builder wrote it up as a missing database column and escalated it to the database builder, who had already added `order_items.name_at_time` and disputed it; Tilotma ruled the finding true (the backend never reads the column), and the system sent it back to the disputer, the database builder, who had nothing to change. The backend builder, who needed to act, never got it with Tilotma's evidence.

**Changed:** `disputes.ts`: a confirmed finding goes to the owner of the file it names (backend/ Shubham, frontend/ Aanya, db/ Pranav); with no path it goes back to whoever disputed it, as before. Proof: a test with three disputes by path.

## Batch 50 — the migration check, still not running inside the worker after the direct docker start (2026-10-25)

**Found:** after batch 47 the worker (restarted onto it) still reported "spawnSync docker ETIMEDOUT [ETIMEDOUT]" while the same call from a shell took 0.7 s. A blocking start also stops the whole worker for as long as it waits. **Changed:** `migration-check.ts` runs docker through the asynchronous `execFile` (own timer, nothing blocked); the injected `exec` may return a promise. Proof: existing tests, and a run on brewline3's real migrations (ran, nothing found, 4 s). Whether it runs inside the worker is confirmed at the next restart.

## Batch 51 — the backend builder gets the migrations in its task text, word for word (2026-10-25)

**Found (brewline3, retry after batch 49):** in the fix round the backend builder tried `dir ..\db\migrations`, `ls ../db/migrations` and list_files on `../db` (shell and parent folder, both refused), never read `../db/migrations/0001_fix.sql`, reported "blocked", and the round stopped with "stuck". The task text only said the migrations could be read; the database builder had already added the column the finding was about.

**Changed:** `shubham/src/index.ts`: `migrationsNoteFor(projectId)` puts every migration file, in order and word for word (capped at 16,000 characters), into both the build task and the fix task. Proof: a test that the fix task contains a later migration's `ADD COLUMN`.

## Batch 52 — the two builders were given different rules for order history (2026-10-25)

**Found (brewline3, the cost question):** one finding, "old orders show the menu item's current name", appeared in 8 of 13 review rounds. The backend builder's rule said copy the item's name AND unit price into the order line; the database builder's rule said only a unit_price. The migration got a price column and no name column, the backend builder cannot write the database, and the finding went between the two builders (with two system faults on top: batch 49 and batch 51).

**Changed:** both rules now name the same two line columns (`name_at_time`, `unit_price`), the backend one adding "write both on insert and read both back, never join to the catalog for them". Proof: a test that both rule texts name both columns.

## Batch 53 — the Chief AI check sees the cited code and may only rule "not true" with a quote (part B of the one-pass plan, 2026-10-25)

**Asked (Amit, after brewline3):** "why Tilotma has a limit of reading files... it can read in parts, or other tools". **Found:** `chief-check.ts` pasted each file cut at 8,000 characters (48,000 in all); a finding about line 296 of `orders.ts` was judged on its first 150 lines, answered "cut off, cannot confirm" and written to `settled-not-true.jsonl` as NOT TRUE; one of the two such dismissals (a `backend/docker-compose.yml` with hard-coded test passwords) was a genuine defect.

**Changed:** `chief-check.ts`: a small file is shown whole, a large one as its first 30 lines plus 80 lines each side of every cited line, numbered (cap 150,000 characters); a "false" verdict is accepted only when the system already proved it (gate flag), when its quote is really in a cited file, or when it is an absence in a file shown whole; otherwise the finding is kept and goes to a builder to confirm. The yardstick gained: no secret in a log or shipped test file (SEC4), no internal brief in user-visible text (SEC8), and one set of business-rule numbers for frontend and backend (INT3).

**Proof:** tests for each rule; on brewline3's real files both recorded "cut off" dismissals now get a prompt that shows the cited code (line 296 present; the compose file shown whole). All suites pass.

## Batch 54 — builders check their own work against the approved plan, and find the known classes before review (part A, 2026-10-25)

**Found (brewline3):** the reviewers judge against the plan's items (SC, EP, ROLES, DESIGN, SEC, INT) but no builder path used the same list, so each gap was a paid review round. Four things found one or two per round were file reads a builder could do: the whole spec pasted into the page description (825 characters), a staff password written to the console, two test compose files with weak secrets left in `backend/` and `frontend/`, a `secure` cookie that breaks sign-in over http. The frontend and backend each invented store hours because the spec said only "during store hours".

**Built:**
- `shipping-hygiene.ts`: `metadataLeakFindings`, `cookieSecureFindings`, `secretLoggingFindings`, `strayShippedFileFindings`, wired into the backend and frontend finish checks (no model call).
- `builder-exit-checks.ts`: `checklistFor` / `checklistTaskText` / `checklistFindings`: the builder's first task carries the plan items that concern it (backend: endpoints, roles, security, integrity; frontend: criteria, design, display security, integrity) and its `task_complete` summary must list each as `[ID] file:line`, or the system refuses to finish. Fix rounds are not held to it. The loops pass the summary to the finish checks (`loop.ts`, `gemini-loop.ts`, `team-files.ts`).
- `saanvi.md`: a business number (hours, minimum notice, limits) is written once, with values, in the spec.

**Proof:** tests for each check, the checklist and the wiring; run on brewline3's real code the new checks report 4 problems that were found only in review (metadata 825 characters, `seedStaff.ts:29` password log, `backend/docker-compose.yml`, `frontend/docker-compose.yml`) with no model call; all suites pass.

## Batch 55 — one full review before a build passes, and the frontend builds beside the backend (parts C and D, 2026-10-25)

**Found (brewline3):** (1) after the first full review, later rounds read only the changed files, so defects in files nobody touched came out one or two per round (the sign-in cookie flag in round 10), each a paid fix and deploy. (2) With one team pass the frontend started only after the whole backend had finished: the generation timeline shows the backend 16–21 minutes and then the frontend 23 minutes in a row, though the frontend's shared files and helpers are told not to run a build, containers or a browser and need no running backend; only the lead's integration does.

**Built:**
- `review-cache.ts` + `stage5-qa-fix-loop.ts`: when the incremental rounds pass after at least one fix round, every reviewer does ONE full pass over all the code (`requestFullReview`; a pass that was only an incremental read does not count, one that was already full on this exact code does and is not paid for again); what it finds is fixed together by the same loop, one extra round is allowed for it, and the full pass is not repeated. A build whose first review is clean is not reviewed twice.
- `build-phases.ts`, `activities/index.ts`, `project-build.ts`: a team phase can run in two stages. "prepare" (shared files and helpers) runs beside the backend; "integrate" (the lead) runs after it, from the files that really exist (any task whose files are still missing goes to the lead); a Retry resumes at the lead's step. Behind the version marker `frontend-prepare-v1`, so builds already running keep the old order. Without prepare nothing changes.

**Proof:** DI tests for the full pass (found after a pass, fixed together, not repeated, not run when the first review is clean), cache tests, team-stage tests (prepare runs no lead; integrate runs only the lead and marks done; integrate without a prepare does the whole team; missing files go to the lead) and a workflow ordering test (frontend prepares at once, integrates only after the backend ends); all suites pass.

**Expected effect (not yet measured in a build):** about 17–23 minutes less generation time on a single-pass plan, at no extra cost; one extra full review (about $1.5–2.5) in place of the repeated incremental rounds.

## Batch 56 — time budgets for the stages that repeat (part D, 2026-10-25)

**Asked (Amit):** "a clean build in 1 hour, not 4 hours". **Found:** nothing in the approved plan or the workflow limited how long a repeating stage could keep starting rounds; brewline3's review loop ran about two hours and its live stage 45 minutes, one round at a time.

**Built:** `time-budget.ts` (`qaBudgetMs` 40 minutes, `liveBudgetMs` 30 minutes by default, `QA_TIME_BUDGET_MIN` / `LIVE_TIME_BUDGET_MIN` to change, 0 to switch off). The review loop (counted from its first review) and the live stage stop starting new rounds when their time is used and hold the build for a human with the findings still open (`guard_hold`); a Retry starts a fresh budget. Proof: tests for the defaults, the environment overrides, a loop held after one slow review with its open findings, the unchanged behaviour with the budget off, and the live stage wiring.

**Not built:** a limit on generation time (a cut-off mid-generation would lose work; the frontend/backend overlap in batch 55 is the generation saving).

## Batch 57 — the review and live stages run the hygiene checks on the finished project (2026-10-26)

**Asked (Amit):** finish Brewline 3 and have the system fix the real defects. **Changed:** `shipping-hygiene.ts` gains `schemaMigrationSyncFindings` (a column a migration adds must be in `db/src/schema.ts`) and `projectHygieneFindings` (all hygiene checks as `[hygiene]` machine findings, each against the file that owns it); `stage5-adversarial-qa.ts` and `stage6-deployment.ts` (`withHygieneFindings`) add them to the review and live findings, `chief-check.ts` treats `[hygiene]` as a proven machine finding (no model decides it), so the fix goes to the owner of the file (frontend Aanya, backend Shubham, db Pranav) through the existing fix loop. Proof: tests (schema sync, owner per file, machine-finding recognition, wiring); on brewline3's real files 5 findings are routed: `layout.tsx` (825-character metadata), `seedStaff.ts:29` (password log), `backend/docker-compose.yml`, `frontend/docker-compose.yml`, and `db/src/schema.ts` (missing `name_at_time`).

**Not covered by a deterministic check:** the store-hours mismatch between frontend and backend; it is fixed only if a reviewer reports it again (it now counts as a plan item, INT3, so the Chief AI check sends it to a builder instead of "later").

## Batch 58 — a reviewer's restatement of a hygiene finding is not fixed twice (2026-10-26)

**Found (brewline3, live round 4):** the hygiene findings and the reviewers' own findings described the same five problems (the password log, the page metadata, the compose file and the schema file each appeared twice), so 11 findings went to the builders for 5 problems. That round, with its fix round, cost about $7 where I had estimated $4–6.

**Changed:** `dedupeAgainstHygiene` (`shipping-hygiene.ts`): a finding that names the same file and the same problem words as a hygiene finding is dropped in the review (`stage5-adversarial-qa.ts`) and live (`stage6-deployment.ts`) stages; a different problem in the same file, or the same words in another file, is kept. Proof: a test with three restatements dropped and two different findings kept; all suites pass.

## Batch 59 — stage 0 of the team plan: a build tests one system version, and the report says whether a run was untouched (2026-10-29)

**Why (audit of 29 Oct, from the records):** none of the 17 full builds ran on one version of the system — between 1 and 49 system commits landed while each one ran — and no build was ever counted as untouched, because nothing recorded it. Approved by Amit as stage 0 of the team plan.

**Built:**
- `pipeline/orchestrator/system-version.ts`: the version of the source folders (`agents`, `packages`, `pipeline`, `apps/api`: their committed content plus any uncommitted change; a commit to docs alone does not change it). It is stamped when the spec step runs (`.nexsidi/system-version.json` in the build folder) and checked before every paid stage that already checks the budget (builders, the review loop and after it, the deploy and after it; not the short compile repair). A version the owner has not accepted holds the build with the new reason `system_changed`; the hold names the folders with committed changes and the files changed since the build started. Retry accepts the new version, and the record keeps that the build ran on a changed system. Git that cannot answer is recorded as "not checked", never as a pass or a hold.
- Workflow: generation, review and deploy route a `SystemChanged` failure to the owner's decision (a new failure type, so no recorded history can contain it). API Retry and the hold card know the reason.
- `pipeline/success-sheet.ts`: the build report opens with a success sheet — untouched yes or no and every reason why not; delivered; holds with their times and reasons; restarts by a person; system version; review rounds; findings in the last round; acceptance tests (not checked until the tester exists); cost; time. A held build's time now ends at its last recorded step, not at the moment the report is made (it said 5,688 min for Brewline 3; the record says 1,416).
- `benchmarks/brewline/`: the fixed benchmark — Brewline 3's brief word for word and the ten answers recorded in its planning chat. Store hours are not in it; when the planner asks, the owner's answer is added so every later run uses the same value.

**Proof:** tests first (version: 16; wiring: 8; success sheet: 10; report: 1); all 2,566 tests pass. On the real repository: stamped, then a throwaway file in `pipeline/` held the check, naming exactly that file; Retry accepted it; removing the file passed. On Brewline 3's real records the sheet reads: not delivered, 7 holds (generation_failed, stuck_state twice, budget_exceeded four times), 6 restarts, version not recorded, 9 code-review and 5 live rounds, $47.84, 1,416 min — the same as the audit.

**Not checked:** a live workflow holding on a system change — starting the worker would also wake Brewline 3, whose 24-hour decision window has passed (it would be marked failed). **Corrected:** the audit said Brewline 2 and 3 had identical briefs; my check compared only the heading line. They differ (Brewline 3's includes the planning answers), so plan stability for one brief is not checked.

## Batch 60 — stage 1 of the team plan: the agents see each other's work (2026-10-29)

**Why (audit and root-cause trace of 29 Oct):** in Brewline 3 the database builder added `order_items.name_at_time` in the first fix round, but:
- the backend builder was refused when it listed `../db` and ran `ls ../db/migrations`, and kept reporting the column missing for an hour;
- the database fix, one model call, could not update `db/src/schema.ts`, read the backend or run its migrations;
- a confirmed finding that came back disputed started with the verdict's preface, not its file, so it went back to the database builder.

Approved by Amit as stage 1. It reverses the reading half of his 2 October decision; writing stays blocked.

**Built:**
- **Reading:** the builders read the whole project: their file tools, and `ls`, `cat`, `head`, `tail`, `wc`, `grep` on any project path (`ownership.ts` `guardCommand` with read-only folders, passed by all three loops). Writing, `node`, `cp` and anything outside the project stay refused, and so do compose files that build another folder. The backend builder's read folder widens from `db/migrations` to the project; the frontend builder gets the same. The core rules and the frontend prompt now say "read any file, change only your own" (they said "never read").
- **Routing:** the Chief AI's verdict may name the file that must change (`settle_dispute` `fix_in`, only `backend/`, `frontend/` or `db/` paths); its owner gets the finding, then the owner of the finding's file, then the builder who disputed it. The owner comes from the first project path in the text, so a finding that comes back after a verdict still reaches the right builder.
- **The database builder is an agent:** a fix round runs in `db/`, reads the whole project, may write only a new numbered migration and `src/schema.ts` (an applied migration is refused), can dispute or hand a finding on (its hand-ons now reach the backend in the review loop), and cannot finish while `schema.ts` misses a column a migration adds or a migration fails on an empty PostgreSQL 16 (a check that cannot run does not block). The first build runs the same checks at once and gives what fails to the agent before anyone reviews (`runChecked`). The single-call fix and its five tests are replaced by twelve agent tests. The "run drizzle-kit, never write SQL" line in its instructions is replaced by the new-migration rule.

**Proof:** tests first (reading 4, builders 5, wording 2, routing 4, database agent 12, review-loop hand-on 1); all 2,587 tests pass. On a copy of Brewline 3's recorded files:
- `list_files ../db`, `ls ../db/migrations` and `cat ../db/migrations/0001_fix.sql` all succeed from the backend folder, and `node ../db/x.js` is still refused;
- replaying its two recorded confirmed disputes sends both to the backend builder (before: one went back to the database builder);
- the database finish check ran its migrations on an empty PostgreSQL 16 (all three apply, 4.8 s, container removed) and flags `db/src/schema.ts` missing `name_at_time` — the defect Brewline 3 ended with.

**Not checked:** the database agent run with a model (a paid call), and any of this in a live build.

## Batch 61 — stage 2, parts one and two: no plan with an open value, and one rulebook (2026-10-29)

**Why (root-cause trace of 29 Oct):** two things in Brewline 3.
- Its spec said "during store hours" with no hours. The frontend builder invented 6:30 AM to 4:00 PM, and the backend file holds both 8:00 and 6:30.
- The rules the reviewers check (security baseline, integrity baseline) were never given to the planner that designs the tables. So the approved plan had no column for the item's name at order time, and the review flagged it for 18 rounds.

**Built:**
- **Open values (`agents/planner/src/open-values.ts`):** opening hours, fees, tax rate, order limits, notice or lead time, and deposit. Each counts as open when the plan names it but gives no value. Opening hours count as given by a clock time anywhere in the plan, so "15-minute windows" is not mistaken for hours. The other facts need the value in a sentence that names them, so an unrelated price elsewhere does not settle "a fee is added". A plan with an open value is not shown: the planner is told to ask the customer with its own question widget in the chat, one question at a time, and to put the answers in the rules word for word. This is the same mechanism that already refuses a plan whose phases do not cover everything.
- **One rulebook (`pipeline/orchestrator/baseline-rules.ts`):** the security and integrity rules move out of `chief-check.ts` into one list, which `chief-check.ts` re-exports. The spec writer and the planner now get it, as do the builders' finish checklist and the reviewers and the Chief AI, as before.

**Proof:** tests first (open values 9, rulebook 2, planner 1, spec writer 1); all 2,600 tests pass. On the recorded requests the check flags:
- Brewline 3: "during store hours" (the value that was invented);
- Trailhead 2: "leave damage deposit in store" with no amount;
- Brewline 1 and 2 and Trailhead 1: nothing (none of them mention hours or a deposit).

**Not checked:** a live planning chat in which the planner asks for the hours (model calls).

## Batch 62 — stage 2, part three: builders ask instead of guessing; the customer sees a plain chat question (2026-10-29)

**Why (root-cause trace of 29 Oct):** the core rules tell every agent "Stop and ask ONE precise question instead of guessing", but builders had no way to ask. Brewline 3's frontend invented store hours of 6:30 AM to 4:00 PM, and no ASSUMPTION line was logged for it. **Amit's rule for this (29 Oct):** inside the system a question goes to the Chief AI with names; for the customer it must read like a chat message, with no agent names or internals (CLAUDE.md confidentiality).

**Built:**
- **`ask_question` (`packages/agent-runtime/src/tools/ask.ts`),** for the backend, frontend and database builders, in their build runs and fix runs.
  - The Chief AI answers only from the customer's request and the approved spec. It must give a quote, and the quote must really be in those documents, or the answer is not accepted.
  - A question they do not answer goes to the customer. The builder is told not to guess and to finish the work that does not depend on it.
  - The same question in other words (matched on key words, so "Store opening hours?" equals "What are the store's opening hours for each day?") is asked once. An answered question is answered from the record.
- **What the customer sees (`packages/agent-runtime/src/customer-text.ts`):**
  - the full roster of agent names, and internal words (builder, reviewer, Chief AI, pipeline, workflow, model names), are found and replaced with plain words, then the grammar is mended ("Shubham, the backend builder, needs …" becomes "We need …");
  - the model writing the question is told the same rule;
  - the API checks again before anything reaches the browser.
- **The pause:**
  - Every paid step (building, review, deploy) stops with a `CustomerQuestion` failure while a question is open. A builder's phase stops before it counts as done, so the answer reaches the work.
  - The review and live loops stop their rounds at once.
  - The workflow sets the stage "awaiting_customer" ("One question for you before we continue."), asks each question, records the answer, and runs the same step again. It is a new failure type, so no recorded history can contain it.
- **The answers reach every agent:** `build-answers.jsonl` goes into every builder's task, into both builders' finish checklists, and into the reviewers' and Chief AI's yardstick as `ANS` items.
- **Web and API:**
  - the build page shows the question as a chat message with a reply box (`CustomerQuestion` in `IdeWorkspace.tsx`);
  - the live status stream carries it, `GET /api/pipeline/:id/question` serves it after a reload, and `POST /api/pipeline/:id/answer` records the exchange in the project's chat history and passes the answer to the build.

**Proof:**
- Tests first: ask 12, wording 6, wiring 4, pause 6, review loop 1, live stage 2, API 5, web 3, yardstick 1. All 2,637 tests in the pipeline, agents, packages and API pass, and all 92 in the web app.
- On Brewline 3's recorded request and spec, with the answer step replaced by its worst replies:
  - made-up hours with a quote that is not in the documents are refused and the question goes to the customer;
  - the backend's reworded question is recognised as the same one;
  - the customer sees "What are the store's opening hours for each day?", with no internal terms;
  - the answer reaches both builders' tasks and checklists and the reviewers' yardstick as ANS1.
- This proof found two defects first, both fixed with tests: the reworded question was asked twice, and the name rewrite read "We, we, needs".

**Correction:** stages 0 and 1 said "all tests pass" but ran only the pipeline, agents, packages and API. The web app's tests had one failure since stage 0 (the pinned list of retryable reasons lacked `system_changed`); it is fixed here.

**Not checked:** a live build that pauses for a question (that needs a worker, which would also wake Brewline 3), the question card seen in a browser (the local browser is not signed in, and I do not enter Amit's password), and the Chief AI's answer with a real model (a paid call). The pipeline routes require sign-in (they answered 401 without a session).

## Batch 63 — stage 3: the tester and the fixed acceptance-test runner (2026-10-29/30)

**Why (root cause 3 of 29 Oct):** nobody wrote down what "works" means before the code. The builders tested their own code and the reviewers judged it afterwards, so every round found something new at the end. "Aarav, the tester" was in the roster but had never been built.

**Built:**
- **The tester (`agents/qa/aarav/`).**
  - It runs right after the customer approves the plan and before any builder. For each build phase it writes acceptance tests from the approved plan only: the request, the plan items, the API contract with its request and answer shapes, the pages, and the answers given.
  - Each test names the plan item it proves (SC, EP, SEC, INT, ANS). There are two kinds: API tests (requests and the expected answers, with values saved between steps) and browser journeys (open a page, fill a field by its label, click by its words, expect text or a page).
  - The system, not the model, numbers the tests and places them in their phase.
  - It runs on the reviewers' model tier. A retry with the same plan reuses the tests (step memo).
- **The Chief AI's check of the tests** (`pipeline/orchestrator/acceptance-tests.ts`, code, no model). It refuses a test that:
  - names no plan item;
  - calls an endpoint the contract does not have, or opens a page the plan does not have;
  - uses what a later phase builds;
  - runs as someone the plan does not have;
  - uses a value that is neither stated nor saved;
  - is malformed.

  The tester is shown each reason and asked for any endpoint or page of the phase with no test, for two rounds at most. What is still missing is recorded as a gap. A phase it cannot write is recorded as "not written", and the build goes on.
- **Builders cannot change the tests.** They are kept in `<build>/acceptance-tests.json`, outside every builder's folder (the file tools refuse the write). Each builder's phase task lists them: the frontend gets the journeys step by step, the backend gets the API tests step by step. In a one-pass team build, both get every test.
- **The fixed runner** (`pipeline/orchestrator/acceptance-runner.ts`, no model). It runs during the live review, with the review's customer and staff accounts.
  - A test it cannot run is "not checked", never passed or failed: the app does not answer, no answer arrives within 30 seconds, the browser cannot start, or there is no account for the role.
  - It waits out the app's rate limit once and reads answers with or without a `{data: …}` wrapper. A number and the same number as text count as equal (Postgres numeric).
  - Records a test creates go on the cleanup list. The sign-in limiter is reset after the run.
  - Every run is kept (`acceptance-runs.jsonl`; the last one in full in `acceptance-results.json`).
  - In this stage the result decides nothing; stage 4 makes passing tests the definition of done.
- **The browser worker** has three new actions that find elements the way a person would, exact words first: fill a field by label or placeholder, click a button or link by its words, choose an option.
- **The success sheet** shows "X of Y passed on the last of N runs (F failed, U not checked)", or that the tests were not written or never run.
- **The workflow** has a new step, "acceptance_tests", behind the replay marker `acceptance-tests-v1`. A budget or system-version hold there asks the owner, like every paid step. The customer sees "Writing down the checks your app must pass, before any code is written."
- **Fixed on the way:** the role reader missed "Restricted to authenticated staff accounts." (Brewline 3's wording). Brewline 3's yardstick therefore said "no other role exists", and its live review had no staff account.

**Proof:**
- Tests first: test format and plan check 14, runner 16, tester 5, wiring 6, success sheet 3, role reader 1. Two older wiring tests were updated for the new step (system-version holds 3 → 4; budget steps 8 → 9; the tester is exempt from the open-question check because no builder has run yet).
- All 2,681 tests in the pipeline, agents, packages and API pass, and all 92 in the web app.
- Type checks: no errors in any file this stage added or changed.
  - Fixed here: a type error in `tools/settle.test.ts` that I introduced in stage 1.
  - Still open: `claude-loop.ts:518` and `team-files.test.ts:57,65`. They come from the exit-check signature change of 25 Oct.
- **Free proof against a local stub app with the real browser:**
  - The stub as planned: 4 passed, plus the 1 failure planted on purpose ("no field labelled Phone on /sign-up").
  - The same stub with the Brewline 3 bug: the INT1 test failed with "items.0.name should equal Flat White but is Renamed Latte".
  - The stub switched off: all 5 tests were "not checked".
  - This proof found three runner defects first, each fixed with a test:
    - a page read during a navigation counted as a failure;
    - a request on a reused connection hung the run for 4 minutes (each request now has its own connection and a 30-second limit);
    - closing a browser worker that had already died raised an unhandled EPIPE.
- **Free proof on Brewline 3's recorded plan (no model):**
  - the tester's task for each of its 3 phases is about 19,000 characters;
  - each task carries the INT1 item-name rule, the 15-minute pickup-slot rule, and the people "anyone", "user", "staff";
  - a hand-written INT1 test placed in phase 2 is refused ("GET /api/v1/orders/:id is built in phase 3") and accepted in phase 3;
  - a pickup time off the 15-minute grid (SC4) is accepted;
  - a DELETE that the contract does not have is refused, and so is a staff page opened before the phase that builds it.

**Prompt size:** each builder's task grows by the test list. On a Brewline-sized plan this is estimated at a few thousand characters; it was not measured on a real tester run.

**Not checked:** the tester with a real model on Brewline 3's plan (a small paid run, needs Amit's OK); the tests run against the real Brewline 3 app (needs its containers started, needs Amit's OK); a live build passing through the new step.

## Batch 64 — stage 4: done means the acceptance tests pass on the running app (2026-10-30)

**Why (root causes 2 and 3 of 29 Oct):** "done" counted activity. A builder finished when it said so; a fix counted when any file was written, disputed or handed on. Nobody owned a feature end to end, so the review rounds found what the build had never shown to work.

**Built:**
- **The acceptance gate** (`pipeline/orchestrator/acceptance-gate.ts`, a workflow step after the build and its compile gate, before the review, behind the replay marker `acceptance-gate-v1`).
  - The system starts the app with the deploy step's fast path: the standard compose file and a rebuild, with no model when that works.
  - The tester's tests run on the app, and each failing test goes, whole, to its owner: an API test to the backend builder, a journey to the frontend builder.
  - A builder that finds the cause in another folder hands it on, and the owner fixes it in the same round.
  - Rounds repeat while more tests pass. Two rounds in a row with no more passing, or 4 fix rounds, end the gate as "failing", and the build holds with the new reason `acceptance_failing`. Retry runs more rounds.
  - An app that cannot be started, or a build without tests, goes on to the review; the result is "not checked", not passed.
  - The step checks the budget, the system version and open customer questions at its start and before every round. Test accounts and the records the tests create are removed afterwards, and the sign-in limiter is reset.
  - The customer sees "Running your app and checking it does what the plan says."
- **A fix is done when its test passes** (`acceptanceFixCheck`, attached to the backend and frontend fix runs through a new `extra.exitChecks` on `runFix`).
  - When the fix run says "done", the system rebuilds the app and runs that run's tests again.
  - "Done" is refused, with the failure, while a test still fails, unless the run disputed the test this round (the Chief AI rules) or handed it on. A change that breaks the app's build is refused too.
  - The check runs only after the builder's own finish checks pass. Rebuilds run one at a time.
- **Disputes:** the Chief AI's existing dispute ruling decides. A test she rules wrong is withdrawn (kept in `acceptance-tests.json` under `withdrawn`, with her evidence) and no longer counts, here or in the final review. A test she rules right goes back to the builder.
- **Fix accounting counts tests:** `testFixOutcome` (fixed, still failing, broken). The gate measures progress by tests passing, not files written.
- **Hand-offs are written down** (`<build>/escalations.jsonl`, from both agent loops), so the finish check can see them.
- **The rebuild no longer blocks the process:** the fast path ran `docker compose up --build` with `execSync`, which stops the activity's heartbeat for the whole image build (the failure docker.ts documents). It now runs asynchronously; this also covers the existing final deploy.

**Different from the plan, and why:**
- The plan named a new evidence kind in `completion-gate.ts`. The existing finish-check hook already refuses "done" and hands the reason back, so the test check uses that hook.
- "Builders run the app at the end of every phase": with builder teams (the default) the whole app is built in one pass, so the gate runs once, after it. With teams off and several phases, it runs once after the last phase. Gating each phase would make the builders wait for each other at every phase; this was not done.
- The database builder's fix runs do not carry the test check; a test handed to it is checked by the next round's run.

**Proof:**
- Tests first:
  - gate 15 (stand-in steps: the build stays open while a test fails; a fix that writes files but leaves the test failing is refused; a dispute is decided by the Chief AI; a hand-off is fixed in the same round; an app that cannot start is not checked);
  - one-at-a-time rebuild 1, hand-off record 1, test accounting and extra check 2, non-blocking rebuild 2, wiring 7.
- Four older count tests were updated for the new step, and one pinned text for the fix rounds' finish check.
- All 2,708 tests in the pipeline, agents, packages and API pass, and all 92 in the web app. Type checks: no errors in changed files except the two of 25 Oct (`claude-loop.ts:518`, `team-files.test.ts`). The type check caught one gap first: the re-fix after a ruling did not report success.
- **Free proof with the real runner and the real browser against a stub app** (fix runs and the ruling are stand-ins):
  - round 1: 1 test passed, 2 failed;
  - the backend's "done" without a fix was refused, with the failure ("items.0.name should equal Flat White but is Renamed …"), and allowed after the fix;
  - the frontend disputed a test asking for a phone field the plan does not have, so its "done" was allowed, and the ruling withdrew the test;
  - round 2: both remaining tests passed, and the gate closed after one fix round.
- This proof found a gate defect first, fixed with a test: a ruling that repeated an earlier withdrawal counted as progress, so the gate never saw it was stuck. It also found a flaw in my own proof test: it reused a menu item that each run renamed. The tester is told to create its own data.

**Cost note:** until stage 5 (the reviewers as the final gate, run once), a build runs both the gate's fix rounds and the existing review loop, so it may cost more than before.

**Not checked:** a real build through the gate (real deploy, model fix runs, the Chief AI's ruling): a paid run, needing Amit's OK.

## Batch 65 — stage 5: the reviewers run once, and every finding needs proof (2026-10-30)

**Why (root cause 6 of 29 Oct):** the review loop was the main engine of a build, about 80% of the spend. The reviewers ran again after every fix round, each round brought findings in files nobody had touched, and a finding reached a builder as text a model had judged. Brewline 3 ran 14 rounds; one finding (the item's name at order time) came back in 11 wordings.

**Built:**
- **The proof rule** (`pipeline/orchestrator/review-proof.ts`). A finding reaches a builder only with proof:
  - a finding about what the customer asked for (an SC, EP, ANS or ROLES item) carries a reproduction, an acceptance test in the tester's format, and the fixed runner must see it fail on the running app;
  - a finding about the rules every app keeps (SEC, INT) or the approved design may instead stand on its quoted code (checked when the reviewer submits it), and the Chief AI's existing check judges it;
  - the system's own checks are proven already.

  A finding without proof goes to `<build>/review-notes.jsonl`, not to a builder. A reproduction that passes on the app is "not reproduced", and goes to the notes too.
- **A reproduced finding becomes a permanent acceptance test** (`AT-R-n`, source "review"). It also becomes an example in the adversarial example database (claim 4): caught by the reviewer that found it, missed by the other two, so it is fed into their next review through the existing training feedback.
- **The review step runs the reviewers once** (`stage5-review-once.ts`, the default; `REVIEW_ONCE=off` restores the old loop).
  - The confirmed code findings and the system's checks get one fix run per owner; hand-offs and disputes work as before.
  - Then the acceptance gate runs every test, the review's new ones included, and fixes until they pass.
  - Anything still open holds the build for a person: a test still failing, or a fix run that could not finish. A review that did not complete is run again twice at most, then held, never passed.
- **The live step runs the browser review and the design review once** (`live-review-once.ts`).
  - The static reviewers are not run again there.
  - A browser finding carries its reproduction at the end of its line (`REPRO: {…}`) and goes through the same rule.
  - Later live rounds run the system's checks and the acceptance tests only. A failing test is a finding for its owner (proven by the runner), counted with the system's own checks.
- **The reviewers are told what proof is:** a `reproduction` field with its full shape on the findings tool, a PROOF paragraph in the static reviewers' plan rule, and the REPRO instruction for the browser reviewer.
- **Fixed on the way:** the plan check refused a test that called a contract endpoint with a real id (`/api/v1/orders/1` for `/api/v1/orders/:id`). Reviewers write real ids, so a concrete value now fits a parameter. The tester's coverage check uses the same rule.

**Proof:**
- Tests first: proof rule 8, review once 8, live review once 5, wiring 3, plan check 1.
- Two older wiring tests were updated: stage 3's "acceptance results decide nothing" is now "a failing test is a finding", and the machine-finding list now includes `[acceptance]`.
- All 2,733 tests in the pipeline, agents, packages and API pass, and all 92 in the web app. Type checks: only the two errors of 25 Oct.
- **Free, on every recorded finding of Brewline 1, 2 and 3:**
  - **Brewline 1:** 10 rounds and 53 findings. Its first review had 16: 9 from the system's checks would reach a builder, 6 name no plan item (notes; this build predates plan-item tags), and 1 was an unfinished review. The later rounds brought 32 more.
  - **Brewline 2:** 6 rounds and 6 findings. Its first review's only finding (an SC2 mismatch) has no reproduction, so it goes to the notes. The later rounds brought 4 more.
  - **Brewline 3:** 14 rounds and 39 findings. Its first review had 6: 5 quoted-code findings on INT1, INT2 and SEC go to the Chief AI's check, and 1 was an unfinished review. The later rounds brought 32 more, among them the item-name finding in 11 wordings.
  - Under review-once, the later rounds' model findings would not be produced. The system's checks in later live rounds still run, so part of those 32 would remain.
  - Of all 97 recorded findings, the ones about the customer's request with no reproduction (9) and those naming no plan item (34) would have gone to the notes.

**Not checked:** a reviewer actually writing reproductions (model calls), a build through the new review (a paid run), and the browser reviewer following the REPRO format.

## Batch 66 — understanding plan, step 1: a blocker stops paid work and is decided from facts (2026-10-30)

**Why (Amit, 30 Oct):** "the owner can't do the edit, then what were you doing — why did nobody flag it… logic, not guess work". Brewline 3 recorded 13 blocker reports. None stopped a round, because only the final live review read them. 14 paid rounds ran after the first report, which said the database builder had to change a migration. I did not read these records during that build either. The website's promise ("software as a system to be understood, not text") is the yardstick for this plan.

**Built:**
- **An open blocker stops paid work.** Every place that checks for an open customer question now also checks for an open blocker (14 places, plus the acceptance gate's waiting check). The rounds inside the gate, the review step and the live step stop on one too.
  - The workflow has the open blockers decided (`resolveBlockersActivity`) and runs the same step again.
  - When the decision is a person's, the build holds with the new reason `blocked`, retryable on the build page in plain words.
- **Each report is decided from facts first** (`pipeline/orchestrator/blockers.ts`, no model). The facts:
  - the paths it names, and their owners (backend/, frontend/, db/; a bare file name is in the reporter's own folder; technology names like "Node.js" are not files);
  - which kind of refusal by our own tools it quotes (not their file, not available in this run, outside their folder, not on the command list, refused);
  - whether one of our own checks demands the same file.

  From the facts alone:
  - a check that demands what a tool refuses goes to a person, quoting both;
  - a change no tool refused, in a file the named owner owns, goes to that owner, who fixes it at once.

  Anything else goes to the Chief AI, whose decision counts only with proof:
  - a quote really in the file;
  - a file really in the owner's folder;
  - a customer question in plain words.

  Otherwise a person decides. Reports on the same facts (the same kind of refusal about the same place, a file inside a named folder included) get one decision; a report that comes back after its decision goes to a person.
- **Decisions are kept** in `<build>/blocker-rulings.jsonl`. Answers found in the code are added to the answers every builder reads (source `code`); customer questions use the stage 2 chat.
- **A contradiction fixed in code:** the shipping check said "a compose file inside the source folder — delete it before finishing", and the deploy-file rule refused the delete (Brewline 3 reports 8, 10, 12 and 13). A builder may now delete exactly those files (a stray `docker-compose*.yml` or `.env` in its own folder). Creating or changing them, or deleting a Dockerfile, is still refused.

**Proof:**
- Tests first: decisions 12, delete rule 1, wiring 5. Four older wiring tests were updated (the decision step is exempt from the open-question check, one more budget-checked step, a longer step window, the pass-through line).
- All 2,751 tests in the pipeline, agents, packages and API pass, and all 92 in the web app. Type checks: only the two errors of 25 Oct.
- **Brewline 3's 13 reports through the rule (free):**
  - they are 7 distinct problems;
  - the CASCADE change (reports 1 and 2) goes to the database builder by facts, at 11:20, where 14 paid rounds actually followed;
  - the two compose-file contradictions (reports 8 and 13, 10 and 12) go to a person by facts, and that contradiction is now fixed in code;
  - 4 go to the Chief AI with proof: actions refused outside the folder (with 4 and 7 and 11 on the same facts; 7 and 11 came after a decision, so they would go to a person), a refused shell command, a refused read of the column name (reading is allowed since stage 1), and the container tool not available in a helper run.
- This proof found three defects in the first version, all fixed with tests:
  - different refusals were merged into one decision (5 with 3, and 6 with 1, which would have sent a read request to the database builder as a change);
  - "Node.js" was taken for a file;
  - a folder and a file inside it were two problems.

**Not checked:** the Chief AI's decision with a real model, and a live build stopping on a blocker (it needs a worker).

## Batch 67 — understanding plan, step 2: the app map, read from the code (2026-10-30)

**Why (Amit, 30 Oct, after reading yugnex.com):** the website promises software "understood as a system, not text". Nothing in the pipeline held an understanding of the app it was building: models re-read files and described them, and the system compared descriptions.

**Built** (`pipeline/orchestrator/app-map/`, code only, no model):
- **SQL reader** (`sql.ts`):
  - the migrations, applied in order, give every table, its columns with type, nullability, defaults and foreign keys with their delete rule (constraints added, dropped and renamed included);
  - each query gives its tables with aliases and join types, the columns it reads, writes and filters on, and where each output column comes from (`COALESCE(name_at_time, mi.name)` is "name_at_time, else menu_items.name");
  - it also records row locks (`FOR UPDATE`), transactions, WITH names, and whether the SQL text is built from values.
  - What it does not understand is listed, never guessed (a `DO $$` block, for example).
- **Code reader** (`code.ts`, the TypeScript compiler's syntax tree):
  - the backend: router mounts, followed through re-exports and barrels, give every endpoint its full path, middleware and handler; the handler and the same-file functions it calls give the SQL it runs. A query text built in code from fixed strings is read: a SET list pushed and joined, with values as parameters, in template or `+` form, and an if/else with two variants.
  - the frontend: each page's route comes from its folders, and its API calls come through the components it imports (only request calls: fetch, apiFetch, api.post …).
  - the Drizzle schema file gives its declared columns. Test files are not the app.
- **The map** (`index.ts`): the database, the schema file against the migrations, every endpoint with its SQL, every page with its calls, SQL that names a missing table or column, frontend calls with no endpoint, endpoints no page calls, every file's owner, and each plan item's endpoints, pages, tables and tests.
  - It is kept in `<build>/app-map.json` and rebuilt after every builder, database, blocker and gate step, and before the review and the live step.
  - `bun pipeline/orchestrator/app-map/cli.ts <build>` prints it.

**Relation to what existed:** `packages/context-chain/src/code-map.ts` (21 Oct, claims 1/3) maps files: imports, exports, symbols, and the file dependency graph. Its alignment record says it is "not yet used by the receiving agent to make decisions". The app map is the layer above it: what the app does. Putting the app map into the handoff context object, and replacing the word-matched requirement links with the map's structural ones, is step 4.

**Proof:**
- Tests first: SQL reader 10, code reader 9, map 6, wiring 2. All 2,778 tests in the pipeline, agents, packages and API pass, and all 92 in the web app. Type checks: only the two errors of 25 Oct (one type error in the new code was caught and fixed).
- **On Brewline 3's recorded code:**
  - At the 14:42 snapshot, the map shows both facts the live review reported at 14:55: `order_items.name_at_time` is in the migrations but not in the schema file, and both order reads take `name_at_time`, else `menu_items.name`.
  - On the final code it shows the order endpoint's transaction (BEGIN, a `FOR UPDATE` lock on the menu rows, the writes including `name_at_time`, COMMIT or ROLLBACK), `menu_item_id` nullable with ON DELETE SET NULL, LEFT JOINs on the reads, every page's calls matched to an endpoint, and nothing that does not fit.
- **On 6 other builds** (Brewline 1, Brewline 2, Trailhead 2, shopbill-9, Leafkeeper 6, Fernly):
  - The first runs found 9 defects in my readers, each fixed with a test: data changes in migrations, `DO $$` blocks cut at semicolons, AT TIME ZONE and EXTRACT read as columns, WITH names as missing tables, `api.post(path, body)` read as GET, string checks taken for API calls, routers and handlers behind re-exports and barrels, `+`-built SET lists, and a placeholder listed as a column. Before these fixes, 34 calls looked like they had no endpoint and 9 columns looked missing.
  - Now: 0 missing columns and 0 calls without an endpoint. Listed and not guessed: 2 `DO $$` blocks, and 5 queries in 3 builds whose SQL is built from substitutions the map cannot trace to fixed strings (step 3's security rule judges each one).
- **Correction recorded:** I told Amit the item-name bug "was never fixed". The snapshots show the backend fixed it by 14:42; the later reports were different facts under the same rule (the read fallback and the schema file). Identifying a problem by "plan item + file" would have merged them; the map identifies it by the fact.

**Note:** the map uses the TypeScript compiler at run time, as `code-map.ts` already does; it is a root dev dependency, so a production install without dev dependencies would need it moved to dependencies.

**Not checked:** the map inside a live build (it needs a worker); apps written outside the generated stack (another router style or ORM would be listed as not read).

## Batch 68 — understanding plan, step 3: the rules every app keeps, checked by code on the app map (2026-10-30)

**Why:** the one rulebook (`baseline-rules.ts`) was text. The builders read it, the reviewers judged it, and a broken rule came back, if at all, rounds later in a model's words: Brewline 3's item-name rule returned for 18 rounds. The map (batch 67) already holds the facts these rules are about, so each rule is now a check on those facts.

**Built** (`pipeline/orchestrator/app-map/rules.ts`, no model). Each broken rule names the fact, the file and line, the owner, and what keeping the rule takes:
- **INT1, history:**
  - An order line is a table with two references, a price or quantity of its own, and a header it is named after (`booking_items` → `bookings`). It must keep its own copy of the item's name and price.
  - The reference to the item must not be ON DELETE CASCADE.
  - Inserts must write the copies.
  - A read of the history (its main table is the line or its header) must not take the name or price from the item. This is sent to the backend only when the copy exists. Without the copy, the missing column is the database builder's fact (Brewline 3: the backend was sent the finding before the column existed).
  - An INNER JOIN on an item whose deletion empties the reference hides lines.
- **INT2, atomic check-then-write:** a stock or availability read followed by a write must run in a transaction with `FOR UPDATE`.
- **SEC1, SQL text from request values:** taint analysis (claim 8) on the syntax tree. It follows only what can become the value:
  - the branches of `a ? b : c` (not its test);
  - not comparisons or number conversions;
  - not lookups in a fixed map of literals, or same-file helpers that return only those;
  - not variables the function checks against a fixed list.
- **SEC2, sign-in and role:**
  - An endpoint the contract marks `auth: true` must have sign-in middleware (at the route, its router, or its mount), or a handler that answers 401 itself.
  - A role-limited one must check the role, or answer 403 itself.
  - An endpoint whose contract states no auth field is not checked, not assumed.
- **SEC9, self-chosen role:** a role or permission column of the account table (the one that stores a password) must not be written from the request, except by a role-limited endpoint.
- **MAP:** SQL naming a missing table or column, the schema file against the migrations, and a frontend call with no endpoint. Such a call goes to the backend when the contract lists it, and to the frontend when it does not. One violation per call site, whatever pages reach it.
- **Invariant (tested):** every violation's file is in its owner's folder, so the review's routing by file sends it to the owner.

**Wired:**
- The builders' finish checks run `mapRuleFindings(build, owner)`: backend, frontend, and the database builder (the schema-file diff is already its own check).
- Review-once adds the broken rules to the one fix run as system findings, whether or not a reviewer reported them.
- `[map-rule …]` counts as a machine finding.

**Reader fixes found by running the rules on recorded builds** (each with a test):
- `router.use(requireAuth)` with the middleware imported from another backend file was read as a mount.
- `as any` on middleware and handlers was not unwrapped.
- Handlers named through `import * as controller` were not followed.
- ESM-style `./routes/tasks.js` imports were not resolved to `.ts`.
- `request(path, "POST", body)` was read as GET.
- `` `/api/v1/tasks${query}` `` was read as a path parameter.
- Next.js route handlers (`app/api/**/route.ts`) were not known as endpoints.
- Postgres's catalog (`information_schema.columns`) was read as a missing table.
- A contract entry `/orders/:id` matched the `/orders/public` endpoint before the exact one.

**Proof on 94 recorded builds** (71 in C:/tmp, 23 in E:/tmp; the rules only read):
- **Before the fixes:** 104 SEC2, 144 MAP, 5 SEC1, 4 SEC9 and 4 INT1 violations. Most were false. All 5 SEC1 hits were request values that reach the SQL only as fixed text.
- **After:** every remaining violation was checked against the source:
  - Brewline 2: 9 INT1 (no copies, CASCADE, reads of the current name and price), INT2 (BEGIN without `FOR UPDATE`), and SEC9 (sign-up takes the role). These are the criticals it shipped with.
  - Brewline 1: INT2 (no transaction).
  - Trailhead 1 and 2: bookings keep no copy of the gear name.
  - Gatherly: order lines keep no copy of the drop title, and `POST /seller/drops` has no role check. It refuses users without a store with a 400 instead.
  - Two task-app builds, 51a0f230ecc2 and 5462533422f6: sign-up accepts `z.enum(["client","admin"])`. complex1's sign-up takes `tenant`/`landlord`, which the rulebook's "lowest role only" also forbids.
  - nextech8: the frontend calls `/inquiries` and `/products`, and the backend serves `/inquiry` and `/product`.
  - 193c3080e582 and 9ae3eeaca80f: empty routers.
  - test9004: `users` is not in its migrations.
  - deadaffe1234: logout is marked signed-in in the contract and not checked.
  - Schema-file gaps in 10 builds.
- **Brewline 3**, final code and all 8 recorded commits (from 20:13 on 25 Oct): one violation, the same in every commit. It is `order_items.name_at_time` missing from schema.ts, owned by the database builder. This is the fact that kept returning under the item-name rule. The rules do not flag its read fallback (`COALESCE(NULLIF(name_at_time,''), mi.name, …)`): every insert writes `name_at_time`, so only rows from before the fix can show the current name, and they have nothing else to show.

**Tests:** rules 18 (with the reader fixes), finish check 2, review-once 1, machine tag 1; the app-map suite 42. Run from the repo root: pipeline 1,028, packages 1,061, agents 611, API 101, web 92 — all pass (run from inside pipeline/ or packages/, 11 tests that import the database client fail on DATABASE_URL, which only the root .env sets; unchanged by this batch). Type checks: only the 25 Oct claude-loop.ts:518 error.

**Not checked:**
- the finish checks inside a live builder run (they need a worker);
- the rules on apps outside the generated stack;
- INT3 (one value for a business number across frontend and backend) and SEC3 (own records only), which the map does not read yet.

**Found, not changed:** `historyIntegrityFindings` (`builder-exit-checks.ts`) is a text-matching INT1 check that nothing outside its tests calls. These rules replace it, and removing it belongs to stage 6.

## Batch 69 — understanding plan, steps 4 and 5: findings known by fact, a shared record, progress by facts (2026-10-30)

**Why:** Brewline 3's item-name finding came back in new words, round after round, and nothing recognised it. The later reports under the same rule were different facts, and nothing told them apart either. The reviewers, the Chief AI and the system's checks each read the code alone. Progress was "more tests pass", so a round that fixed a broken rule counted as no progress, and a round that changed nothing could not be told from one that tried.

**Built:**
- **Finding identity** (`app-map/identity.ts`). An identity is the rule or plan item the finding cites, plus the place in the map its file and line fall in:
  - an endpoint (the line is in one of its queries or inside its handler);
  - a helper function (the innermost named function, e.g. `orders.ts#validatePickupSlot`);
  - a table (a migration; the first table of the map the finding names);
  - a page, or else the file.
  The map now records each handler's lines and every backend function's lines.
- **The ledger** (`<build>/findings-ledger.jsonl`): which identities went to which builder, and when.
- **Review-once:** one finding per identity reaches the fix run. The map's broken rule comes first, because it carries the fact. A finding whose identity was sent before is marked "CAME BACK: sent to <builder> at <time>…". A finding that cites no id is never merged.
- **Structural traceability** (`app-map/trace.ts`; claim 3's two-way links). Every link names the fact it rests on:
  - plan item → endpoint, page or table: the item names it exactly, or one of its acceptance tests requests or opens it;
  - endpoint → route, handler and query files;
  - page → page file and the files its calls are in;
  - table → the migrations that create it or add its columns.
  The word-matched trace in `packages/context-chain` stays, for files the map does not read.
- **The handoff context object** now carries `appMap`: the code facts' SHA-256 digest, the endpoints with their handler files, the tables, and the structural links. These are code facts only: no times and no tests, which change between record and check without the code changing.
- **The shared record** (`app-map/section.ts`): the app as the system read it, and the rules its checks already found broken ("do not report them again"). It goes into the static reviewers' context, the live reviewers' plan block and the Chief AI's prompt, capped at 12,000 or 8,000 characters.
- **Progress by facts** (acceptance gate, step 5):
  - A round makes progress when more tests pass, or fewer facts are open: the identities of the rules the map finds broken (`codeFacts`).
  - Two rounds with neither hold the build. The reason lists the rules still broken.
  - When the code's digest did not change, the reason says the fixes "changed nothing the app map reads in the code".
  - Deviation from the step 5 plan, on the facts: a changed digest alone is not counted as progress. Code that changes while no test passes and no rule closes is churn, and counting it would let a build spend rounds without getting closer.
- **SEC9 with control flow:** a role written with a value that a branch on the request chooses counts as chosen by the caller. RateGate's sign-up sets `finalRole = "admin"` when the body asks for admin and an environment secret matches. The rulebook allows staff accounts only from a seed or from someone who already has the role. SQL text (SEC1) still follows data only: a literal chosen by a condition is safe SQL.
- **Removed:** the text check `roleFromRequestFindings`, which matched the words "role" and "sign-up". On 94 builds the map's SEC9 finds every case it found, and not its false one: 9739da9032b0, a contact's job title.

**Proof:**
- **Brewline 3's recorded review findings** (`rounds.jsonl`: 39 findings in 14 rounds). Each was identified on the code of its time: the 14:42 snapshot and the 8 commits. The rounds before 14:42 have no recorded code, so they were placed on the 14:42 code and are marked so.
  - 39 findings make 23 identities.
  - The item-name read, reported 6 times between 12:32 and 13:26 in different words, is one identity: `INT1|endpoint:GET /api/v1/orders`. From its second report it would have been marked come back.
  - The insert (`INT1|endpoint:POST /api/v1/orders`), the schema file (`INT1|table:order_items`) and the pickup-slot helper (`EP7` and `SC4` at `orders.ts#validatePickupSlot`) come out as different facts. This is the correction on record from batch 67.
- **Brewline 3's code facts at each commit:** one open fact throughout, `MAP|table:order_items` (the schema file). Only 4 distinct digests across 8 commits: 4 fix commits changed nothing the map reads. Under step 5 the gate would have held the build after two such rounds and named the fact.
- **Tests:** identity 5, trace 4, the handoff 1, review-once 2, gate 2, the real gate 1, the shared record 2 (Chief AI and live reviewers), SEC9 control flow 1, and the finish check rewritten to the fact version 1.

**Not checked:**
- the shared record's effect on what reviewers report (it needs a paid review);
- the gate's progress rule in a live build (it needs a worker);
- identity of findings that cite no file and line (left unmerged by design).
