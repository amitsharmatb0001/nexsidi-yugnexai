// Phase 5 Task 7 (final-bundle/phase5-harness-enforcement-plan.md):
// authorization gate primitive, Wing-2 ready. Fail-loud blocking gate, same
// pattern as agents/riya/src/index.ts's resolveDeployTarget("gcp") — called
// FIRST, before any work. Wing 1 uses it for the PRIVILEGED pending_human
// class; Wing 2's engagement gate (nexsidi-secwing-charter boundary #1 —
// "no authorization record = pipeline refuses to start") consumes it as-is.
// Pure function, zero infra — persistence of records is a later, separate
// concern (out of scope here, per the plan).

export interface AuthorizationRecord {
  scope: string;
  authorizedBy: string;
  expiresAt: string; // ISO 8601
}

export class AuthorizationError extends Error {
  readonly field: "record" | "expiresAt" | "scope";

  constructor(field: "record" | "expiresAt" | "scope", message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.field = field;
  }
}

export function requireAuthorization(record: AuthorizationRecord | null, requiredScope: string): void {
  if (!record) {
    throw new AuthorizationError("record", "No authorization record — refusing to start (fail-loud, same gate pattern as resolveDeployTarget)");
  }
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    throw new AuthorizationError("expiresAt", `Authorization expired at ${record.expiresAt}`);
  }
  if (record.scope !== requiredScope) {
    throw new AuthorizationError("scope", `Authorization scope "${record.scope}" does not cover required scope "${requiredScope}"`);
  }
}
