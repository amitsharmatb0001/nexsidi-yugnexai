# Patent alignment — what the code does against what was filed

Written 2026-10-21. Internal. Plain-language versions: `docs/patent/for-the-lawyer.md` and `docs/patent/conversation-record.md`. Not legal advice; the claim text is the one in
`E:\dev doc pat\Form2_Provisional_Specification_YUGNEX.md` (the same claims are in the `.docx` of the same name).
The PDF `Provisional Specification_Form 2.pdf` (10 Feb 2026) could not be read here; confirm with the attorney that it carries the same claims.

## What was filed, and the dates that follow from it

- A **provisional** specification (Form 2, The Patents Act 1970), dated 31 Dec 2025 in its own declarations. CLAUDE.md records Indian application
  #202611001020 filed 5 Jan 2026. The inventor declaration says a complete specification will be filed within 12 months (Section 9).
- Per the searches below, a provisional is deemed abandoned if the complete specification is not filed within 12 months of its filing date, and
  a PCT application claiming priority is filed within the same 12 months (Paris Convention). Indian national phase is 31 months from priority.
  Both secondary sources disagree on whether the 31 months can be extended, so check the Rules.
- CLAUDE.md says the PCT deadline is 4 Jan 2027 and that no attorney is engaged yet. That could not be verified from the repository.
- 2026-10-21: the claims in `Form2_Provisional_Specification_YUGNEX (1).docx` (the original) were compared word for word with the `.md` copy
  (919 words each, identical after normalising), so the table below applies to both.

## What the patent professional said on the call (`E:\dev doc pat\Person 2 Statements.markdown`, translated from Hindi/English)

These are the lines of one speaker only; the other side of the call, who she is, and the quotation she mentions are not in the file.

- The claims and the full information go into the application; it is the **final version and cannot be changed afterwards**.
- **Code is not required** in a patent.
- An **app is not registered** as a patent; what must be shown is a **process improvement or methodology improvement**, and what is finally
  claimed on that improvement.
- Keep **hardware and software** in mind: **software per se gets no protection**.
- Next step on her side: give the details and inputs and the go-ahead for the **complete application**. She says she mostly emailed the
  request at the start, and asks to check the quotation in that email and to email her with questions.

What this means for the work, from the statements alone:
- The complete application should be written around technical process steps and their technical effect, not around the app. That is why the
  elements that are really built and measurable (hash chain over all predecessors, isolated execution with kernel-visible limits, live check
  that finds defects) matter more than ones that exist only as prompts or not at all.
- Because the final version cannot be changed, every element described must be one the system really does. See the status table below
  and decide, with her, which unbuilt elements are built first or left out of the claims.
- This call suggests a patent professional is already in contact; CLAUDE.md's "attorney not engaged" line may be out of date.

## Implementation status, claim by claim

"Built" means working code that has been run; "partly" says what is missing; "not built" means no code found for that element.

| Claim / element | Status | Evidence and gaps |
|---|---|---|
| 1(a) DAG task graph | Built | `pipeline/orchestrator/dag.ts` (cycle and dangling-reference detection), used in multi-agent development |
| 1(a) capability-profile assignment | Built 2026-10-21, narrow | `agents/arjun/src/capabilities.ts`: profiles (skills and folders) for the three generator agents; every task in a new plan is checked and moved only on strong evidence (all its files in another agent's folder, or clear skill words when it names no files); each decision stored on the plan. Moved none of the 335 tasks in 24 real plans. Other agents (QA, deploy) have no dynamic assignment |
| 1(b) specialised agents | Built | requirements, architecture, generator agents |
| 1(c)/3(b) SHA-256 verification with rollback | Built 2026-10-21 | `packages/context-chain`; a corrupt handoff is refused and the project's own files are restored from the last good snapshot and files added since are removed (dependencies, build output and agent histories are not touched). The snapshot copy after each handoff is best-effort: if it fails a warning is logged and the handoff goes ahead |
| 1(c)/3(a) context objects with AST, dependency graph, metadata | Not built | contexts are the agents' outputs hashed as JSON |
| 1(d)/2(c) three independent adversarial agents in parallel | Partly | three QA agents run in parallel; they are prompted, not "trained with error-maximisation objective functions" |
| 1(e)/2(d)/5 isolated ephemeral containers | Built 2026-10-21, with gaps | `packages/agent-runtime/src/sandbox`: private PID/net/mount/UTS/IPC namespaces, unprivileged user, cgroup v2 CPU/memory/process limits, Docker seccomp whitelist, no network, read-only root, container removed after the run; each layer observed from inside a real container. Missing: I/O bandwidth limit, kernel user-namespace remap (daemon setting), timeouts are software timers not hardware. Wired into the build commands behind `NEXSIDI_SANDBOX_BUILDS=on` (off on Windows: much slower there) |
| 1(f)/6(a) iterative refinement, convergence detection | Built | stuck-state detection in the fix loop |
| 6(b) iteration limits by hardware timer | Partly | counters and software timeouts |
| 6(c) alternative strategy generation | Built 2026-10-21, in two places | `pipeline/orchestrator/strategies.ts`: six different approaches plus an optional model-generated one (`NEXSIDI_STRATEGY_MODEL=on`), a record of what was tried. In the Express Build repair loop a problem that comes back gets a new approach, never one already used. In the main pipeline's fix loops the hold report lists untried approaches for the developer; they are not tried automatically there |
| 3(c) bidirectional traceability graph | Not built | |
| 3(d) transactional atomic handoff | Built 2026-10-21 | a handoff's chain row and its file are one unit inside one database transaction; the file is written whole, read back, checked against the recorded hash and moved into place; any failure leaves neither. Proven on the real database (blocked handoff left no row and no stray file; chain still audited clean) |
| 4 GAN training, adversarial example database, curriculum | Not built | the mistake-memory table is not an adversarial example database |
| 7 mistake memory | Built | 511 stored patterns (6 global), injected into generator prompts; extraction is counting and confidence, not statistical analysis |
| 8 security agent: pattern database, taint analysis, penetration payloads | Not built as claimed | no taint analysis; injection payload text appears in generator instructions only |
| 9 performance agent: Big-O, leak detection, regression across iterations | Not built as claimed | the performance agent's prompt mentions them; no analysis code, no cross-iteration comparison |
| 10 hash chain of all predecessors | Built 2026-10-21 | each record stores every earlier record's context hash and a chain hash; audit function; proven on the real database (parallel handoffs, tamper detected) |

Express Build does not use these mechanisms. It copies a finished app, applies edits, and runs its own live check; it has no inter-agent
context chain, adversarial agents or container isolation of its own.

## Things in CLAUDE.md that are product features but not filed claims

RSA signing of outputs (built, all chain rows signed), OTP/PIN approval before execution (not built), Chief AI Officer hierarchy (built), "100% full
retest after every finding" (built per code comments). Do not describe these as patent claims.

## Research notes (secondary sources; verify with the attorney)

- India's 2025 Computer Related Invention guidelines (issued 29 Jul 2025) centre on "technical effect / technical contribution"; business methods
  stay excluded; for AI/ML the disclosure expectations are higher than in 2017. Software "per se" is excluded under section 3(k).
  Sources: <https://www.aippi.org/news/decoding-cri-guidelines-2025/>, <https://www.barandbench.com/view-point/revised-cri-guidelines-2025>,
  <https://www.iam-media.com/article/indian-patent-office-releases-highly-anticipated-examination-guidelines-computer-related-inventions>
- Deadlines: <https://ssrana.in/ip-laws/patents/patents-flowchart-in-india/>, <https://iipla.org/national-phase-entry-in-india/>,
  <https://www.intepat.com/patent-deadline-tracker>
- Startup fee rebate (80%) and expedited examination: <https://legallyindia.com/the-bar-and-bench/startupindia-throwaway-patent-filing-fee-discount-of-80-per-cent-for-start-ups-20160118-7121>,
  <https://www.taxaj.com/learn/?p=938> (2016 to 2021 era sources; the current fee schedule must be checked)

## Questions for the attorney

1. Which elements of the claims need working implementations before the complete specification, and which can be rewritten around what exists?
2. The claims say agents are "trained with explicit error maximisation objective functions" and use "GAN-based training"; the system prompts models. Is the claim language still supportable?
3. Can the work done since January (copy-and-adapt of a finished app with lineage tracking, a live check with automatic repair, hash chain over all predecessors) go into the complete specification, a PCT application, or separate applications?
4. How does the 2025 India guideline treatment of AI affect how the technical effect should be described?
5. Does showing the system to investors before filing matter, and should demonstrations be under NDA?
