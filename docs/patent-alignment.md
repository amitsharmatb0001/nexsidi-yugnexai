# Patent alignment — what the code does against what was filed

Written 2026-10-21. Internal. Not legal advice; the claim text is the one in
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
| 1(a) capability-profile assignment | Not built | no capability profiles found; agents are assigned by fixed role |
| 1(b) specialised agents | Built | requirements, architecture, generator agents |
| 1(c)/3(b) SHA-256 verification with rollback | Built, minimal | `packages/context-chain`; rollback raises and escalates, it does not restore files |
| 1(c)/3(a) context objects with AST, dependency graph, metadata | Not built | contexts are the agents' outputs hashed as JSON |
| 1(d)/2(c) three independent adversarial agents in parallel | Partly | three QA agents run in parallel; they are prompted, not "trained with error-maximisation objective functions" |
| 1(e)/2(d)/5 isolated ephemeral containers | Built 2026-10-21, with gaps | `packages/agent-runtime/src/sandbox`: private PID/net/mount/UTS/IPC namespaces, unprivileged user, cgroup v2 CPU/memory/process limits, Docker seccomp whitelist, no network, read-only root, container removed after the run; each layer observed from inside a real container. Missing: I/O bandwidth limit, kernel user-namespace remap (daemon setting), timeouts are software timers not hardware. Wired into the build commands behind `NEXSIDI_SANDBOX_BUILDS=on` (off on Windows: much slower there) |
| 1(f)/6(a) iterative refinement, convergence detection | Built | stuck-state detection in the fix loop |
| 6(b) iteration limits by hardware timer | Partly | counters and software timeouts |
| 6(c) alternative strategy generation | Not built | |
| 3(c) bidirectional traceability graph | Not built | |
| 3(d) transactional atomic handoff | Not built | |
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
