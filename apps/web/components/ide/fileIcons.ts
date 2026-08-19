/**
 * File-type marks for the explorer.
 *
 * A short letterform plus a colour, rather than an icon font: the tree is
 * dense and monochrome, so a two-character tag reads faster at 13px than a
 * glyph does, and it never falls back to a missing-glyph box the way an icon
 * font can when the face has not loaded.
 */

export interface FileMark {
  tag: string;
  color: string;
}

const MARKS: Record<string, FileMark> = {
  ts:     { tag: "TS", color: "#5B9BD5" },
  tsx:    { tag: "TS", color: "#5B9BD5" },
  js:     { tag: "JS", color: "#D9B04C" },
  jsx:    { tag: "JS", color: "#D9B04C" },
  mjs:    { tag: "JS", color: "#D9B04C" },
  cjs:    { tag: "JS", color: "#D9B04C" },
  json:   { tag: "{}", color: "#C08A5E" },
  sql:    { tag: "SQ", color: "#C77DBB" },
  css:    { tag: "CS", color: "#7BA7D7" },
  scss:   { tag: "CS", color: "#C77DBB" },
  html:   { tag: "<>", color: "#D2745A" },
  md:     { tag: "MD", color: "#8E8E96" },
  yml:    { tag: "YM", color: "#79A98C" },
  yaml:   { tag: "YM", color: "#79A98C" },
  sh:     { tag: "SH", color: "#79A98C" },
  env:    { tag: "EN", color: "#9C8B5E" },
  example:{ tag: "EN", color: "#9C8B5E" },
  local:  { tag: "EN", color: "#9C8B5E" },
  png:    { tag: "IM", color: "#8F7CC4" },
  jpg:    { tag: "IM", color: "#8F7CC4" },
  jpeg:   { tag: "IM", color: "#8F7CC4" },
  svg:    { tag: "IM", color: "#8F7CC4" },
  ico:    { tag: "IM", color: "#8F7CC4" },
  lock:   { tag: "LK", color: "#6E6E76" },
};

const DEFAULT_MARK: FileMark = { tag: "··", color: "#6E6E76" };

/** Files whose whole name carries the meaning, not their extension. */
const BY_NAME: Record<string, FileMark> = {
  dockerfile:            { tag: "DK", color: "#5B9BD5" },
  "docker-compose.yml":  { tag: "DK", color: "#5B9BD5" },
  "docker-compose.yaml": { tag: "DK", color: "#5B9BD5" },
  ".gitignore":          { tag: "GI", color: "#6E6E76" },
};

export function fileMark(name: string): FileMark {
  const lower = name.toLowerCase();

  const byName = BY_NAME[lower];
  if (byName) return byName;

  // ".env.local" and "tsconfig.json" both end in a meaningful segment, so the
  // last dot-segment is the right key for both.
  const dot = lower.lastIndexOf(".");
  if (dot === -1 || dot === lower.length - 1) return DEFAULT_MARK;

  return MARKS[lower.slice(dot + 1)] ?? DEFAULT_MARK;
}
