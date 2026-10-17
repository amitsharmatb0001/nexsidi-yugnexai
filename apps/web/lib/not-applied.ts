/** The parts of a request an Express Build reported it could not apply, as plain text lines. */
export function notAppliedOf(body: Record<string, unknown>): string[] {
  const raw = body.notApplied;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}
