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
