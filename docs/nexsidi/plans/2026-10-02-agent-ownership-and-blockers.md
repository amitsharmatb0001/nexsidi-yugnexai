# Agent ownership and blocked reports — implementation plan

Approved by Amit on 2 Oct 2026, after Ledgerly benchmark run 2: the frontend builder spent
42 of its 90 steps chasing a backend it could not reach, read other agents' folders with
its own scripts, and built the backend and database from its own compose file.

**Goal:** every agent does only its own work; only Tilotma sees everything; a blocked
agent reports to Tilotma and carries on instead of working around the problem.

## Rules (from Amit)
- No agent changes, runs or reads another agent's work. Each agent works in its own folder.
- Tilotma has access to the whole project.
- When an agent cannot get what it needs, it checks once and reports; it never assumes.

## Tasks

### 1. Ownership enforced in code (`packages/agent-runtime/src/ownership.ts`)
- File tools: the folder check requires a path separator (`backend` must not match `backend-old`).
- `run_command`: any path argument outside the agent's folder is refused.
- `node` runs with Node's permission mode: read and write only inside the agent's folder,
  no child processes. Verified on this machine (Node 22.17.1): reads and writes elsewhere and
  spawning are refused with ERR_ACCESS_DENIED.
- `bun` only for install/add/remove; `npx tsx`, `npx ts-node`, `npx node` refused (use `node`).
- `docker_compose up`: a compose file whose build context or mounted folder is outside the
  agent's folder is refused.

### 2. `report_blocked` tool (`packages/agent-runtime/src/tools/blocked.ts`)
- Every agent has it, in every stage. Arguments: owner, what is blocked, what was checked.
- The runtime appends the report to `<build>/blockers.jsonl` and logs `[blocked]`.
- The agent is told: reported to Tilotma — do not work around it, continue your own task.
- Tilotma's live review (Stage 6) gets every report and verifies each one on the running app;
  its findings go to the owner through the existing fix loop.

### 3. Blocked-action detector (`packages/agent-runtime/src/blocked-actions.ts`)
- A tool result is "blocked" when it was refused for being outside the folder, not allowed,
  or could not connect.
- After 3: a notice — you are blocked, call report_blocked and continue your own task.
- After 6: the run stops (work so far is saved), a report is filed automatically, and the run
  is not handed to another model (the same wall would stop it too).
- Wired into all three loops (NIM, Gemini, Claude).

### 4. Earlier wrap-up
- Step-budget notice also at 80% of the steps used.

### 5. Instructions
- core-reasoning.md (every agent): own work only; never assume another agent's state; check
  once, then report_blocked.

### 6. Tilotma sees everything
- Tilotma's evidence collector and reality checker get the whole build folder (read-only) and
  the list of blocked reports.

## Verification
Tests first for each task; full `bun test packages/agent-runtime agents pipeline` and
typecheck before the commit; then run 3 of the benchmark proves it live.
