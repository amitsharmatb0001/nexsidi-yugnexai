// What a {type:"stage"} event from /api/pipeline/:id/status does to the
// build page's status.
//
// 2026-09-28: real bug seen live (project a61968de2ecf). The page used to set
// status "building" for EVERY stage event. When a build halts (needs_review,
// e.g. budget_exceeded) the stream ends with stage "error" — which flipped a
// correctly-loaded needs_review back to "building", hid the "needs your
// attention" card and its Retry button, and left only the stream's generic
// "Execution failed. View system logs for details." on screen. An error stage
// is terminal: keep the status the result endpoint reports, and re-fetch it.
export function statusForStageEvent(stage: string): { status: "building" | null; refetchResult: boolean } {
  if (stage === "error") return { status: null, refetchResult: true };
  return { status: "building", refetchResult: stage === "done" || stage === "deliver" };
}
