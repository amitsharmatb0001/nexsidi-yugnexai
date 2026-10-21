# Patent work — record of the conversation of 21 October 2026

Kept so the facts, the corrections and the open decisions are not lost when a long session is compacted. Plain language on purpose.
Technical detail with file names is in `docs/patent-alignment.md`. The short list for the lawyer is `docs/patent/for-the-lawyer.md`.
This is not legal advice.

## 1. The facts

- The filed paper is a **provisional specification** (Form 2, The Patents Act 1970). Original file: `E:\dev doc pat\Form2_Provisional_Specification_YUGNEX (1).docx`.
  Its declarations are dated 31 December 2025. Our notes record filing on 5 January 2026 as application 202611001020. That date and number were not checked against the Patent Office.
- The `.md` copy of the same name has the identical claims (compared word for word: 919 words each). A PDF copy dated 10 February 2026 could not be read here.
- The paper has 10 claims: 3 independent (system, method, context protocol) and 7 that depend on them.
- Inventor and company declarations in the paper say a **complete specification** will be filed within 12 months.
- A call with a patent professional ("Person 2") is saved in `E:\dev doc pat\Person 2 Statements.markdown`. Only her lines are there.

## 2. A correction

CLAUDE.md contained a table of "10 patent claims" that is **not** the filed list. It named RSA signing, a one-time-password approval, a chief-AI-officer
hierarchy and a "100% retest" rule. None of these is a filed claim. CLAUDE.md was corrected on 21 October 2026. An earlier answer in this conversation
used the wrong table; the statuses given afterwards use the filed claims.

## 3. What the call said (translated from Hindi and English)

- The claims and full information go into the application. It is the **final version and cannot be changed afterwards**.
- Code is **not** needed in a patent.
- An app is not registered as a patent. What must be shown is a **process or methodology improvement**, and what is finally claimed on it.
- Hardware and software both matter. **Software on its own gets no protection.**
- Next step: Amit gives her the details and inputs and the go-ahead for the complete application. She says she emailed the request at the start, and asks Amit to check the quotation in that email and email her with questions.
- Not known from the file: who is on the other side, the quotation, and whether an attorney is formally engaged. CLAUDE.md says none is engaged; the call suggests someone is in contact.

## 4. Where the software stands

Full tables: `docs/patent/for-the-lawyer.md`.

- **Done:** ordered task breakdown; SHA-256 checking of handoffs with stop-and-alert; the hash record where each entry holds all earlier hashes (claim 10); three checking agents in parallel; locked throwaway container (claim 5); repeat until progress stops; memory of past mistakes.
- **Partly:** checking agents are instructed, not trained; container missing a disk-speed limit, user remapping, hardware timers; security and performance agents have text only; undo does not restore files; mistake memory counts and does not use statistics.
- **Not done:** task assignment by agent skills; code map in handoffs; requirement-to-code map; all-or-nothing handoffs; training the checking agents; a new approach when stuck; taint analysis and attack-input tester; real speed and memory analysis.

Express Build (copy a finished app and change it) does not use these mechanisms.

## 5. Built in this conversation

- Claim 10: each record keeps the hashes of all earlier records of its project. Proven on the real database: four handoffs recorded at the same moment got positions 1 to 4, altering record 2 was caught, restoring it made the chain valid again (commit 55cb938).
- Claim 5: a locked throwaway container runner. Each layer was observed from inside a real container. It can run the build checks in the container (switch `NEXSIDI_SANDBOX_BUILDS=on`), off by default because on this Windows PC builds are 7 to 37 times slower in it (commit dd5b7c9).
- CLAUDE.md claims table corrected; status document written (commits 33754ac, de97d6e).
- Earlier the same day: Express Build live check and automatic repair, fresh secrets and ports per copy, response and date format rules (see `docs/` and the git log).

## 6. Questions Amit asked, with the plain answers

- *Is the app built on the patent?* About half. The rest is partly done or not done. Express Build does not use the patented mechanisms.
- *Can we file a PCT or Indian patent from this?* Possible; the lawyer decides. A provisional must be followed by a complete specification or a PCT within 12 months of filing, which is about 5 January 2027. (From secondary sources; to be confirmed.)
- *Are we modifying the original claims, mixing in new ones?* **No.** The filed provisional is untouched and cannot be edited. Only the later complete application has claims that are still to be written, and the lawyer writes them. Work done after the filing may not get the January date unless it was described then; the lawyer decides how to cover it.
- *Why did you say "leave it out"?* Because the complete application cannot be changed after it is filed, so each claimed item should be one the software really does. For each missing item there are two choices: build it, or leave it out of the complete application's claims. Amit and the lawyer choose.

## 7. Decisions still open

1. For each "not done" and "partly" item: build it, or leave it out of the complete application? (Lawyer and Amit.)
2. The wording "trained" and "GAN-based training": keep, change, or build real training? (Lawyer.)
3. Whether work done after the filing goes in the complete application, a PCT application, or separate applications. (Lawyer.)
4. Who "Person 2" is, what the quotation says, whether an attorney is engaged; update CLAUDE.md. (Amit.)
5. Whether to send the lawyer `docs/patent/for-the-lawyer.md` and an inputs pack. (Amit.)
6. A Linux server for the container to be on by default. (Amit.)

## 8. What it would take to build the rest

Effort is in working days of building and testing, rough, plus or minus half. Live test builds cost about $0.50 to $2 each in model charges.
Nothing here changes the filed paper.

### Not done

| Item | What would be built | Effort |
|---|---|---|
| Task assignment by skills | Skill tags on each agent and each task, a matching step, a log of why each task went to which agent. Today tasks have only a description, a size and what they depend on, and the agent table has no skills | 1 to 2 days |
| Code map in handoffs | Before each handoff, build the code's structure and what-depends-on-what from the generated files with the TypeScript compiler, add the spec's rules and the current error records, and hash it all | 3 to 4 days |
| Requirement-to-code map | Give each requirement an ID, link requirements to tasks, files and findings, store it, and allow questions in both directions | 3 to 4 days |
| All-or-nothing handoffs | Write each handoff to a temporary place, check it, then switch it in as one step; keep earlier versions so it can be undone. Same work as "undo that restores files" below | 2 days (shared) |
| Training the checking agents | Software version: score each checker by confirmed defects found, keep a store of missed defects that comes back as test cases, and raise the difficulty round by round. Real model training would need data, hardware and weeks, with an uncertain result | 5 to 7 days for the software version |
| New approach when stuck | When progress stalls, ask for several different approaches, try the next one, and remember which were tried | 1 to 2 days |
| Taint analysis | Follow untrusted input (request data) through generated code to risky places (database queries, shell commands, file paths, HTML output), in the code itself | 5 to 7 days, with false alarms to tune |
| Attack-input tester | Send standard attack inputs (database injection, script injection, path tricks) to every route of the running app with a test account and judge the answers | 3 to 4 days |
| Speed and memory analysis | Estimate growth from loop nesting and queries inside loops; find leaks by hitting routes repeatedly and watching memory; compare speed and memory between rounds | 7 to 8 days |

### Partly done

| Item | What would be built | Effort |
|---|---|---|
| Checking agents "trained" | The scoring and missed-defect store above, so the claim has a measurable objective | about 2 days beyond the item above |
| Locked container gaps | A disk-speed limit; user remapping (a setting for the whole Docker engine on the server); kernel-enforced time limits (these are not literally hardware timers, so the wording is for the lawyer); turn it on for builds on a Linux server and check speed | 2 to 3 days, needs a Linux server |
| Security agent database | A stored list of attack patterns and public vulnerability entries, filled by the existing vulnerability feed, and used by the checker | 3 to 4 days |
| Undo that restores files | Versioned copies of each stage's files so a bad handoff puts the last good ones back (shared with all-or-nothing handoffs) | 2 days beyond shared work |
| Memory of mistakes with statistics | Rate of recurrence across projects compared with chance, minimum evidence, and a significance score before a pattern is kept | 2 days |

### Totals and order

- Roughly 40 to 50 working days if done one after another. About ten weeks remain to the January 2027 date.
- Suggested order: handoff undo and all-or-nothing, new approach when stuck, skill-based assignment; then the code map and requirement map; then the attack-input tester, the security database and the speed and memory checks; then taint analysis; training only after the lawyer decides.
- Build only what the lawyer wants claimed. Anything she leaves out is time saved.
- Needs from Amit: the decisions in section 7, a Linux server for the container items, and a review of each piece when it is done.

## 9. Notes from earlier in the day on a live server and a beta

- A small invite-only beta on a Linux server is possible. It needs the platform itself packaged for a server (only a development setup exists), a front door with subdomains and HTTPS for the apps it builds, a larger Docker network pool (about 30 apps at once is the current limit), the open development ports closed, a spend cap per user, and the code pushed (137 local commits were not pushed at the time).
- A fully open public beta is not supported by anything tested.
- The browser used for checking is hidden by default; showing it, or recording it, is a small change that has not been built.

## 10. Update, later the same day: the three quickest items were built

- **All-or-nothing handoffs and restoring files** (commit b8c8521). A handoff's record and file are one unit; a corrupt handoff is refused and the project's own files are put back. Proven on the real database: two handoffs left two records, two files and one snapshot (the second changed nothing, so it was not copied again); a handoff that could not complete left no record and no stray file and the chain still verified; an altered handoff was refused, the damaged file was restored and the intruder file removed.
- **A different approach when stuck** (commit 459240e). Six different approaches plus an optional model-written one; in the repair of newly built apps, a problem that comes back gets a new approach, never one already used. In the main fix loops the held-work report lists approaches nobody has tried; they are not tried automatically there.
- **Assigning tasks by skill** (commit 365d893). Profiles for the three builder agents; a task moves only on strong evidence. Run on the 24 real plans on disk (335 tasks) it moved none, so it is a safety net that past plans did not need.
- All test suites pass after the changes. Items still open are those in section 8 not listed here.
