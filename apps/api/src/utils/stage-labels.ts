// Security Layer 7: the single deny-by-default translation from an internal
// Temporal stage name to what a user is allowed to see. Every route that
// exposes pipeline stage to the browser (SSE status stream, the projects
// list) must import from here rather than keep its own copy — two safe-lists
// drifting apart is exactly how an internal stage name (or, worse, an
// iteration/attempt count) ends up reaching the client unfiltered.
//
// Moved out of routes/pipeline.ts (2026-08) so routes/projects.ts can share
// it without duplicating the map.
export const USER_STAGE_MESSAGES: Record<string, string> = {
  spec: "Getting started on your app...",
  decompose: "Planning out the build...",
  await_spec_approval: "Plan ready — approve it to start code generation.",
  generate: "Writing your code. This usually takes 2-4 minutes.",
  qa: "Running quality checks...",
  qa_fix: "Improving the code based on quality checks...",
  live_test: "Testing the live app...",
  await_deploy_approval: "Verification complete — approve to deliver the app.",
  deliver: "Almost done — packaging everything up.",
  done: "Your app is ready!",
  error: "Something went wrong. We're on it.",
};

/** Stages where the pipeline is paused specifically waiting on the user. */
const APPROVAL_STAGES = new Set(["await_spec_approval", "await_deploy_approval"]);

export interface TranslatedStage {
  stage: string;
  message: string;
  needsApproval: boolean;
}

export function translateStage(stage: string): TranslatedStage | null {
  const message = USER_STAGE_MESSAGES[stage];
  if (!message) return null; // deny — unknown/internal stage never reaches the client
  return { stage, message, needsApproval: APPROVAL_STAGES.has(stage) };
}
