// What an editing pass reports it could not apply. A request can name something the base app does not have (an
// "edit" screen that was never built); the pass must not invent it or skip it quietly, so it says so in its summary
// and this reads those lines back out for the person who made the request.

const NOT_APPLIED = /^\s*(?:[-*•]\s*)?(?:\d+[.)]\s*)?not applied\s*[:\-–—]\s*(.*)$/i;

export function extractNotApplied(summary: string): string[] {
  const found: string[] = [];
  for (const line of summary.split(/\r?\n/)) {
    const m = NOT_APPLIED.exec(line);
    const text = m?.[1]?.trim();
    if (text && !found.includes(text)) found.push(text);
  }
  return found;
}
