import { test, expect } from "bun:test";
import { wsRootStyle } from "./IdeWorkspace.styles.ts";

// 2026-09-27: real bug seen live (project a61968de2ecf, 1920px window) — the
// build page laid out 1999px+ wide and clipped its right edge (the Panels
// drawer, the account menu, the stream's "Completed" labels and the
// "Approve & launch" button). The shell grid declared only rows, so its one
// implicit column was `auto`, which grows to the row's min-content: the
// widest nowrap line in the build stream. minmax(0, 1fr) caps the column at
// the viewport so the stream shrinks (it already has minWidth 0) instead.
test("the build page shell's single column can shrink below its content (never wider than the viewport)", () => {
  expect(wsRootStyle.gridTemplateColumns).toBe("minmax(0, 1fr)");
});
