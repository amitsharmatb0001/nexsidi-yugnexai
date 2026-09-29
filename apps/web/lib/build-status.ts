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
//
// 2026-09-28: same bug, wider (project a034f90ba50e): after generation failed
// the stream kept reporting the stage the workflow is parked at ("generate"),
// and "building" hid the Retry card for 30 minutes. While the page believes
// the project needs review, a stage event re-checks the result endpoint (the
// DB status is authoritative; a retry from anywhere sets it back to building).
export function statusForStageEvent(
  stage: string,
  currentStatus?: string,
): { status: "building" | null; refetchResult: boolean } {
  if (stage === "error" || currentStatus === "needs_review") return { status: null, refetchResult: true };
  return { status: "building", refetchResult: stage === "done" || stage === "deliver" };
}

export type ResultStatus = "waiting" | "building" | "done" | "failed" | "needs_review";

// What GET /api/pipeline/:id's result means for the page. An app URL has
// always meant "done" (including a failure that still shipped an app) —
// EXCEPT needs_review: 2026-09-28 (project a61968de2ecf) the app was up but
// its post-launch check failed, and treating the URL as "done" hid the
// "needs your attention" card and its Retry button, so the build could not
// be resumed from the UI.
//
// 2026-09-29 (project a034f90ba50e): nor while the build is still running —
// the app URL is saved at launch, before the live review and its fixes, and a
// Retry keeps the previous run's URL.
export function statusFromResult(r: { status: ResultStatus; appUrl?: string | null }): ResultStatus {
  if (r.status === "needs_review" || r.status === "building") return r.status;
  return r.appUrl ? "done" : r.status;
}
