# Build brief: claim 8, testing the running app with attack inputs

For whoever builds this part (a person or another tool). It describes what to build, where it plugs in and the limits it
must keep. It contains no attack inputs; the recommendation is to use an established open-source scanner instead of
writing them.

## What the filed claim asks for

Claim 8 (dependent on claim 1): a security agent with an OWASP/CVE pattern database, taint analysis, and
**penetration-test payloads (SQL injection, script injection)** used against the generated application.

## What already exists (do not rebuild)

- Pattern database: 20 code patterns (OWASP 2021 category, CWE, severity, fix) and 20 package advisories, in the
  `security_patterns` and `security_advisories` tables, with an OSV import. Code: `packages/agent-runtime/src/security/pattern-scan.ts`.
- Taint analysis: request data followed to SQL, shell, eval, file path, fetched URL, redirect and HTML sinks.
  Code: `packages/agent-runtime/src/security/taint.ts`.
- Both run in the review stage and go to the security reviewer as leads (`pipeline/orchestrator/stages/security-scan.ts`),
  and each run leaves a claim 8 evidence line (`packages/agent-runtime/src/claims-evidence.ts`).

## What is missing

Sending test inputs to the **running** generated app and reporting what it did with them. Today nothing does that.

## Recommended approach: OWASP ZAP in its own container

Use OWASP ZAP (open source, Apache 2.0, maintained) rather than hand-written inputs. It ships tested injection checks,
an API scan mode that reads an API description, and a JSON report.

1. **Target.** The app is already running for the live retest (Stage 6: `pipeline/orchestrator/stages/stage6-deployment.ts`,
   `runRealLiveRetest`), from the project's own `docker-compose.yml`, with backend on its port and the database in its
   own container.
2. **Where ZAP runs.** A throwaway container (`docker run --rm`) attached **only** to the project's compose network, so
   it can reach the app's backend and frontend services by name and nothing else. Use the existing sandbox limits as a
   model (`packages/agent-runtime/src/sandbox/container-sandbox.ts`: CPU, memory, process and time limits, removed
   afterwards). The compose network must be one with no route out (an `internal: true` network), or ZAP must be given
   only the app's service names as allowed hosts.
3. **What it scans.** The backend API, using the project's `api-contract.json` converted to an OpenAPI description (the
   contract already lists every endpoint, method and request type), plus the frontend's pages from the route sweep's
   route list. Limit the scan policy to the injection categories the claim names (SQL injection, cross-site scripting,
   and command injection if the code map shows a shell call), at low strength first.
4. **Signed-in routes.** Sign up a test account on the reserved test domain (`verify+…@example.com`, the shape the
   cleanup already removes) and give ZAP its bearer token, the same way `seedSampleData` gets one.
5. **Results.** Parse ZAP's JSON report. Each alert with medium or higher risk becomes a finding with the endpoint, the
   parameter, ZAP's evidence string and its CWE, mapped to the file through the code map in the deploy handoff
   (`codeMap.files`). Send them to the security reviewer as confirmed live results (not leads), the same way the
   pattern scan's leads are added to its input today.
6. **Evidence.** One claim 8 line per run: `recordClaimEvidence(buildDir, 8, "attack inputs sent to the running app", { requests, alerts, high, medium, endpointsCovered, seconds })`.
7. **Cleanup.** After the scan run the existing `purgeVerificationArtifacts(buildDir, testingStartedAt)`; the row-count
   check in Stage 6 already fails the deploy if anything the scan wrote is left behind.

## Interface to build

```ts
// pipeline/orchestrator/stages/attack-input-test.ts
export interface AttackTestResult {
  ran: boolean;              // false when ZAP or the target could not be reached; the reason is in `notRun`
  notRun?: string;
  findings: Array<{ file: string; issue: string; cwe?: string; risk: "high" | "medium" }>;
  requests: number;
  seconds: number;
}
export async function runAttackInputTest(projectId: string, backendUrl: string, frontendUrl: string): Promise<AttackTestResult>;
```

Call it from `runRealLiveRetest` after the route sweep, behind a switch (`NEXSIDI_ATTACK_TEST=on`), off by default until
proven.

## Limits it must keep (all required)

- Targets only the project's own containers on the project's own compose network. Never a host name or address outside
  it; refuse to start if the target URL is not one of the compose services.
- Never runs against a deployed or customer-facing copy, only the local test deployment Stage 6 brings up.
- Time cap per run (for example 10 minutes); the container is removed when it ends, pass or fail.
- Test accounts only on the reserved test domain; all rows it causes are removed by the existing cleanup.
- Never runs on another project's network; one scan per project at a time.
- The scan output is evidence for the owner and the reviewer; it is not shown to end users of the generated app.

## How to prove it works (acceptance)

1. Unit tests: report parsing (a saved ZAP JSON report, high/medium kept, low dropped), mapping to files through a code
   map, the refusal when the target is not a compose service, and the switch being off by default.
2. A planted flaw: copy a real generated backend, change one query to string concatenation (the training module's
   mutation operators already do this: `packages/agent-runtime/src/training/mutations.ts`), deploy it locally, run the
   test, and show the alert on that endpoint and parameter.
3. A clean app: run it on a delivered app with no planted flaw and report the alerts honestly (expect some low ones).
4. The evidence line appears in `bun scripts/claims-report.ts <project>`.
5. The row-count check after cleanup passes.

## Known costs and risks

- Docker Desktop on Windows: ZAP's image is large (about 1.5 GB) and the scan is slow on a shared folder; it is better
  run on the Linux server.
- An active scan writes data through the app's forms. That is why the cleanup and the row-count check must run after it.
- ZAP reports some false positives; the security reviewer confirms each before it becomes a fix task, which the review
  loop already does for every finding.
