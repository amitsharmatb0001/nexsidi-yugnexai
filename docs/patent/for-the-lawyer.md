# Where the software stands against the filed provisional specification

Prepared 21 October 2026 from the software itself; updated the same day after three items were built. For Amit to review before it is shared. Not legal advice.

**Document compared:** `Form2_Provisional_Specification_YUGNEX (1).docx` (declarations dated 31 December 2025). The filing date and application number
(5 January 2026, 202611001020) are as recorded in our internal notes; they were not checked against the Patent Office record.

**How to read this:** each item below comes from the filed claims. "Done" means the software really does it and it has been run.
"Partly" says what is missing. "Not done" means we found no working code for it.

## Done

| What the filing describes | Claim |
|---|---|
| Breaking the work into an ordered set of tasks | 1, 2 |
| Checking that what one agent passes to the next has not been altered (SHA-256), and stopping if it has | 1, 2, 3 |
| A linked record where each entry holds the hashes of all earlier entries | 10 |
| Three checking agents that review the work at the same time | 1, 2 |
| Running code in a locked, throwaway container: separate process and network space, limits on processor, memory and number of processes, a list of allowed system calls, no network, removed after the run | 1, 2, 5 |
| Repeating fix and check until progress stops | 1, 2, 6 |
| A memory of past mistakes that changes later prompts, with a statistical test (across projects, against the background rate, corrected for testing many patterns, minimum evidence) deciding which patterns are put first. Weak while there are few projects | 7 |
| A detailed map of the code passed on with the work: for each file its structure, what it imports and exports, what depends on what, import cycles, the rules from the plan, and errors found in the code; hashed and checked like the rest of the handoff. Built for the handoff before deployment only; the receiving step does not yet use it to make decisions | 1, 3 |
| A map linking each requirement to the tasks and files that implement it, and each file back to the requirements it serves, with the reason for each link; lists requirements with no code and files with no requirement. Links are made by matching words, so some are wrong or missing (on 8 real projects: 38 of 39 requirements and 307 of 479 files linked) | 3 |
| Giving each task to the agent whose skills fit it best: each of the three builder agents has a profile, and a task moves only on strong evidence (its files sit wholly in another agent's folder) | 1 |
| Handoffs that either fully succeed or are fully undone: the record and the handoff file are written as one unit | 3 |
| When a handoff turns out to be altered, the project's own files are put back to the last good state | 1, 3 |
| When the same problem comes back after a repair, the next try uses a different approach, never one already used (in the repair of newly built apps; in the main fix loops the held-work report lists untried approaches but they are not tried automatically) | 6 |

## Partly done

| What the filing describes | What is missing | Claim |
|---|---|---|
| Checking agents "trained" to find as many errors as possible | They are given instructions. They are not trained. | 1, 2 |
| Locked container | Disk-speed limit now built. Remapping of user identities is a setting of the container engine on the server: instructions written, not switched on, not tried on a Linux server. The time limit is enforced inside the container by a kernel timer, not a hardware timer. On by default on Linux, off on the development PC | 1, 2, 5 |
| Security checking agent | It has a list of common attack types as text and a feed of public vulnerability reports, but no stored pattern database | 8 |
| Performance checking agent | Its instructions mention speed and memory problems, but it does not analyse anything | 9 |
| Maximum number of rounds | Limited by counters and software timers, not hardware interrupts | 6 |

## Not done

| What the filing describes | Claim |
|---|---|
| Training the checking agents against the code-writing agents, with a stored list of missed defects and a ramp from easy to hard cases | 4 |
| A security test that follows untrusted input through the code, and sends attack inputs to the running app | 8 |
| Estimating how slow code gets as data grows, finding memory leaks, and comparing speed between rounds | 9 |

## Work done after the filing

This is described here only so it can be considered; whether any of it belongs in the complete application is for the lawyer.
It is not described in the filed text as far as we can tell.
- Copying a finished app and applying requested changes to the copy, keeping a private record of which app it came from and removing every trace of it.
- After building an app, testing it in a real browser with a test account and sample data, repairing what is found, and testing again.
- Giving each copy its own secret keys and network addresses.

## Questions

1. Which of the "not done" items must exist as working software before the complete application, and which can be left out of its claims?
2. The filing says the checking agents are "trained" and uses "GAN-based training". Our agents are given instructions. Does the wording need to change?
3. Can the work done after the filing go into the complete application, a PCT application, or separate applications?
4. How should the technical effect be described under the 2025 Indian guidelines on computer-related inventions?
5. Does showing the system to investors before filing matter, and should demonstrations be under an NDA?
