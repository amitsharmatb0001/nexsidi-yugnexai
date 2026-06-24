// One function per pipeline stage.
// Each is a Temporal activity: retryable, timeout-bounded, observable.

export async function runSaanvi(_projectId: string): Promise<void> {
  // TODO Phase 1: call Saanvi agent via agent-bus
}

export async function runArjun(_projectId: string): Promise<void> {
  // TODO Phase 1: call Arjun agent via agent-bus
}

export async function runShubham(_projectId: string): Promise<void> {
  // TODO Phase 1: call Shubham agent via agent-bus
}

export async function runAanya(_projectId: string): Promise<void> {
  // TODO Phase 1: call Aanya agent via agent-bus
}

export async function runPranav(_projectId: string): Promise<void> {
  // TODO Phase 1: call Pranav agent via agent-bus
}

export async function runSpecCompliance(
  _projectId: string,
  _iteration: number,
): Promise<boolean> {
  return true; // TODO Phase 1
}

export async function runNavya(_projectId: string, _iteration: number): Promise<number> {
  return 100; // TODO Phase 1 — returns score 0-100
}

export async function runKaran(_projectId: string, _iteration: number): Promise<number> {
  return 100;
}

export async function runDeepika(_projectId: string, _iteration: number): Promise<number> {
  return 100;
}

export async function runCodeFix(
  _projectId: string,
  _iteration: number,
  _reason: string,
): Promise<void> {
  // TODO Phase 1
}

export async function runLiveTest(_projectId: string, _iteration: number): Promise<number> {
  return 10; // TODO Phase 1 — returns score 0-10
}

export async function logStuckState(
  projectId: string,
  iteration: number,
  minScore: number,
  improvement: number,
): Promise<void> {
  console.warn(`[pipeline] stuck-state detected project=${projectId} iter=${iteration} minScore=${minScore} improvement=${improvement}`);
  // TODO Phase 1: write to stuck_state_log table
}

export async function escalateTilotma(
  _projectId: string,
  _reason: string,
  _state: unknown,
): Promise<void> {
  // TODO Phase 1: Tilotma asks user ONE specific question with concrete options
}

// Fix #9: Riya creates GitHub repo + pushes generated code before user delivery
export async function runRiya(_projectId: string): Promise<void> {
  // TODO Phase 1:
  //   1. docker-compose up → verify app boots on localhost:3000
  //   2. create GitHub repo under GITHUB_ORG
  //   3. push generated code
  //   4. update projects.github_repo in DB
  //   5. deliver: URL + repo + PRD + feature list (never agent names)
}
