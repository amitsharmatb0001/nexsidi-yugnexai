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
