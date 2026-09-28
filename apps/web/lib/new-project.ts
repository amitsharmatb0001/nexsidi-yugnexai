// Validation for the "New project" modal. 2026-09-28 (Amit): the description
// ("What are you building?") is optional — a name is enough to create a
// project; the app gets described in the chat that opens next.
export function newProjectError(name: string, _context: string): string | null {
  return name.trim() ? null : "Give the project a name.";
}
