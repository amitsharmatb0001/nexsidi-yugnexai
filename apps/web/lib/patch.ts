/**
 * Reconstructs the two sides of a change from a unified diff.
 *
 * The API's /diff/file endpoint returns a unified patch, but <DiffView> takes
 * `before` and `after` text and derives its own hunks — which is what buys the
 * word-level intra-line highlighting a raw patch cannot express. Splitting the
 * patch back into its two sides is the adapter between them.
 *
 * The result is context-only: lines the patch never mentions are not in either
 * side. That is exactly what a diff view renders anyway, so nothing is lost.
 */
export function patchToBeforeAfter(patch: string): { before: string; after: string } {
  const before: string[] = [];
  const after: string[] = [];
  let inHunk = false;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }

    // File headers only exist ahead of the first hunk. Inside one, every line
    // is prefixed content — a removed line reading "--- a rule" arrives as
    // "---- a rule", and treating that as a header would silently drop it.
    if (!inHunk) continue;

    // "\ No newline at end of file" is a note about the previous line, not content.
    if (line.startsWith("\\")) continue;

    if (line.startsWith("+")) {
      after.push(line.slice(1));
    } else if (line.startsWith("-")) {
      before.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      before.push(line.slice(1));
      after.push(line.slice(1));
    }
    // Anything else (a stray blank line between hunks) carries no content.
  }

  return { before: before.join("\n"), after: after.join("\n") };
}
