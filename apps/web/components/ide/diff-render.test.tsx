import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DiffView } from "@/components/nexui/diff-view";
import { patchToBeforeAfter } from "@/lib/patch";

/**
 * End-to-end check of the Changes view's rendering path against a patch a
 * generator actually produced, rather than a hand-written one: unified patch
 * from the API -> patchToBeforeAfter -> <DiffView>.
 *
 * This is the path behind "open a file and see what changed", so it is worth
 * pinning to real output — the earlier hand-made fixtures did not exercise
 * word-level highlighting inside a modified line at all.
 */
const patch = readFileSync(join(import.meta.dir, "__fixtures__", "real-compose.patch"), "utf8");

// Tags are stripped before asserting: DiffView splits a changed line into
// per-token spans, so a raw-HTML substring match would fail on text that is
// plainly present on screen.
const text = (html: string) => html.replace(/<[^>]*>/g, "");

test("both sides of a real generated patch survive the round trip", () => {
  const { before, after } = patchToBeforeAfter(patch);
  expect(before).toContain('"5435:5432"');
  expect(after).toContain('"5436:5432"');
  expect(before).not.toContain('"5436:5432"');
});

test("renders the removed and the added value, each on its own row", () => {
  const { before, after } = patchToBeforeAfter(patch);
  const html = renderToStaticMarkup(
    <DiffView before={before} after={after} filename="docker-compose.yml" showLineNumbers />,
  );
  const flat = text(html);

  expect(flat).toContain("5435:5432");
  expect(flat).toContain("5436:5432");

  // The gutter markers are what carry add/remove meaning to a reader.
  expect(flat).toContain("−");
  expect(flat).toContain("+");
});

test("marks changed words inside a modified line, not just the whole line", () => {
  const { before, after } = patchToBeforeAfter(patch);
  const html = renderToStaticMarkup(
    <DiffView before={before} after={after} filename="docker-compose.yml" />,
  );

  // The port digits are the only thing that changed on that line, so they must
  // be wrapped in their own element — that wrapper is the word-level highlight.
  expect(html).toMatch(/<span class="[^"]+"><span[^>]*>5435<\/span><\/span>/);
  expect(html).toMatch(/<span class="[^"]+"><span[^>]*>5436<\/span><\/span>/);
});

test("applies syntax colours inside the diff", () => {
  const { before, after } = patchToBeforeAfter(patch);
  const html = renderToStaticMarkup(
    <DiffView before={before} after={after} filename="docker-compose.yml" />,
  );
  expect(html).toContain("--nx-syn-property");
  expect(html).toContain("--nx-syn-string");
});
