// Required checks the agent skipped are run by the system before task_complete
// is judged (2 Oct 2026). Ledgerly benchmark run 3: the frontend builder
// finished its work and called task_complete at step 90 of 90 without having
// run `npx tsc --noEmit` and the `cat app/...` file checks. The gate rejected
// it and a working frontend was thrown away — every one of those checks
// passed when run afterwards. The checks are mechanical; who runs them does
// not change the evidence. A check that fails is returned with its output so
// the agent can fix the real problem.
import { execRunCommand } from "../tools/command.ts";
import type { EvidenceLedger } from "./evidence.ts";

export async function runMissingRequiredChecks(
  sandboxDir: string,
  ledger: EvidenceLedger,
  requiredCommands: string[] = [],
): Promise<string[]> {
  const failures: string[] = [];
  for (const command of requiredCommands) {
    if (ledger.hasSuccessfulCommand(command)) continue;
    const result = await execRunCommand(sandboxDir, { command, timeout_ms: 300_000 }, ledger);
    if (result.status !== "success") {
      const output = String(result.output ?? "").slice(-1500);
      failures.push(`${command} failed: ${result.summary}${output ? `\n${output}` : ""}`);
    }
  }
  return failures;
}
