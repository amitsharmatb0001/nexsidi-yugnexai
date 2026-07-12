// 2026-07-12: real bug found live (zero-intervention autonomous test) —
// Navya called read_file on the IDENTICAL path 20 times in a row without
// ever calling submit_findings, burning the full iteration budget (paid
// Gemini calls) before falling through to a generic "Max iterations
// reached" message with no indication of what it was actually stuck on.
//
// The existing strike counter (enforce/strikes.ts) only catches a
// run_command call FAILING identically — it never fires on a call that
// keeps SUCCEEDING without making progress (read_file on the same path,
// docker_compose logs on the same service, list_files repeatedly). That
// gap exists identically in loop.ts (NIM) and gemini-loop.ts (Shubham/
// Aanya/Riya's real generator loops), not just qa-loop.ts (Navya/Karan/
// Deepika) — this is shared so every agentic tool-calling loop in the
// codebase gets the same early-exit instead of each loop reinventing it.
//
// Pure and dependency-free on purpose, same convention as strikes.ts's
// evaluateCommandStrike — directly unit-testable without mocking the
// network. Threshold matches the "3 consecutive rounds, no improvement"
// window already used elsewhere in this codebase (stage5-qa-fix-loop.ts's
// STUCK_THRESHOLD, CLAUDE.md's stuck-state guidance).
export function detectStuckLoop(recentSignatures: readonly string[], threshold = 3): boolean {
  if (recentSignatures.length < threshold) return false;
  const last = recentSignatures.slice(-threshold);
  return last.every((s) => s === last[0]);
}
