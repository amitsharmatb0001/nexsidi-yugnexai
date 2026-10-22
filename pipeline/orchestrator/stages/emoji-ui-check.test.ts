import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { findEmojiInUi } from "./emoji-ui-check.ts";

// 2026-10-22 (Trailhead Gear Rentals, reviewed by hand): product cards showed a pink backpack emoji and a bed emoji as the
// pictures of tents, packs and sleeping bags, and icons across the booking pages were emoji too. It reads as a template, not
// a real shop, and no check looked for it. Emoji used as UI graphics are now a finding the frontend builder must fix.
test("emoji used as UI graphics are found, one finding per file with the lines", () => {
  const src = [
    `export function Icon({ c }: { c: string }) {`,
    `  switch (c) { case "tents": return "⛺"; case "backpacks": return "\u{1F392}"; }`,
    `  return <div style={{ fontSize: "3rem" }}>\u{1F332}</div>;`,
    `}`,
  ].join("\n");
  const f = findEmojiInUi("frontend/components/GearCard.tsx", src);
  expect(f).toHaveLength(1);
  expect(f[0]!.file).toBe("frontend/components/GearCard.tsx");
  expect(f[0]!.issue).toContain("lines 2, 3");
  expect(f[0]!.issue).toContain("image");
});

test("typographic marks are not emoji", () => {
  expect(findEmojiInUi("a.tsx", `<p>© 2026 Shop™. Done ✓ ®</p>`)).toEqual([]);
});

test("the review stage adds these findings like the dead-button ones", () => {
  const src = readFileSync(new URL("./stage5-adversarial-qa.ts", import.meta.url), "utf-8");
  expect(src).toContain("scanProjectForEmojiUi(projectId)");
  expect(src).toContain("...emojiFindings");
  expect(src).toContain("emojiFindings.length === 0");
});
