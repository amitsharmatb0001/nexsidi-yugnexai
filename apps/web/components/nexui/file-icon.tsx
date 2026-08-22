"use client";

import { css } from "@yugnex/core";

/**
 * How a file changed in a generated changeset.
 *
 * Lives here rather than in file-tree because file-tree, file-tabs,
 * diff-view, and review-gate all speak this vocabulary, and file-icon is the
 * one module all of them already depend on — so sharing it costs no extra
 * copied file, and nothing has to redeclare it.
 */
export type FileStatus = "new" | "modified" | "deleted" | "unchanged";

/* ------------------------------------------------------------------ *
 * Glyph set
 *
 * Every path below is drawn for this library on a 16x16 grid — geometric,
 * single-stroke, and readable at 14px. Deliberately not an icon font or an
 * imported set: the whole library ships zero runtime dependencies, and a
 * file explorer that needed an icon package would break that for the sake
 * of ~40 small shapes.
 * ------------------------------------------------------------------ */

interface Glyph {
  /** Rendered inside a 16x16 viewBox, stroked with currentColor. */
  path: string;
  /** OKLCH-ish hue angle, 0-360. Lightness/chroma are set per theme. */
  hue: number;
}

const G = {
  /* --- Structure & markup --- */
  // Angle brackets — JS/TS source.
  markup: { path: "M6 4L2 8l4 4M10 4l4 4-4 4", hue: 15 },
  // Angle bracket + slash — HTML/XML.
  tag: { path: "M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9.5 3l-3 10", hue: 25 },
  // Braces — structured data.
  braces: { path: "M6 3H5a2 2 0 0 0-2 2v1a2 2 0 0 1-2 2 2 2 0 0 1 2 2v1a2 2 0 0 0 2 2h1M10 3h1a2 2 0 0 1 2 2v1a2 2 0 0 0 2 2 2 2 0 0 0-2 2v1a2 2 0 0 1-2 2h-1", hue: 90 },
  // Stacked layers — component frameworks.
  layers: { path: "M8 2l6 3-6 3-6-3 6-3zM2 11l6 3 6-3M2 8l6 3 6-3", hue: 260 },
  // Nested squares — bundlers/monorepo tooling.
  nested: { path: "M2.5 2.5h5v5h-5v-5zM8.5 8.5h5v5h-5v-5zM8.5 2.5h5v5h-5v-5z", hue: 275 },

  /* --- Styling & media --- */
  // Droplet — stylesheets.
  droplet: { path: "M8 2.5s4 4.2 4 6.8a4 4 0 0 1-8 0c0-2.6 4-6.8 4-6.8z", hue: 200 },
  // Wind stroke — utility CSS.
  wind: { path: "M2 6h7.5a2 2 0 1 0-2-2M2 9.5h9a2 2 0 1 1-2 2M2 12.8h4.5", hue: 190 },
  // Image frame.
  image: { path: "M2.5 3.5h11v9h-11v-9zM2.5 10l3-3 3 3 2-2 3 3", hue: 300 },
  // Bezier node — vector art.
  vector: { path: "M3 12c0-4.5 3-7.5 7.5-7.5M2 11.5h2v2H2v-2zM11 3.5h2v2h-2v-2z", hue: 315 },
  // Type specimen — fonts.
  glyphMark: { path: "M3.5 4.5v-1h9v1M8 3.5v9M6 12.5h4", hue: 330 },

  /* --- Prose --- */
  // Text lines — plain prose.
  lines: { path: "M3 4h10M3 8h10M3 12h6", hue: 220 },
  // Hash + lines — markdown.
  markdown: { path: "M2.5 5.5h11M2.5 8h11M2.5 10.5h6M11 3v10M7.5 3v3", hue: 230 },
  // Bound page — PDF/print.
  bound: { path: "M4 2.5h8v11H4v-11zM6 2.5v11M8 5.5h2.5M8 8h2.5", hue: 355 },

  /* --- Execution --- */
  // Terminal chevron — shell.
  terminal: { path: "M3 5l3 3-3 3M8.5 11H13", hue: 145 },
  // Play triangle — tasks/scripts.
  play: { path: "M5 3.5l8 4.5-8 4.5v-9z", hue: 165 },
  // Container blocks — Docker.
  container: { path: "M2 9h12v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9zM4 6.5h2.5V9H4zM7 6.5h2.5V9H7zM7 4h2.5v2.5H7z", hue: 210 },
  // Gear — tooling config.
  gear: { path: "M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 2v1.6M8 12.4V14M14 8h-1.6M3.6 8H2M12.2 3.8l-1.1 1.1M4.9 11.1l-1.1 1.1M12.2 12.2l-1.1-1.1M4.9 4.9L3.8 3.8", hue: 250 },
  // Hexagon — runtime version pins.
  hexagon: { path: "M8 2l5 3v6l-5 3-5-3V5l5-3z", hue: 135 },

  /* --- Data --- */
  // Cylinder — databases.
  cylinder: { path: "M8 2c3 0 5 .9 5 2s-2 2-5 2-5-.9-5-2 2-2 5-2zM3 4v8c0 1.1 2 2 5 2s5-.9 5-2V4", hue: 30 },
  // Grid — spreadsheets.
  grid: { path: "M2.5 3.5h11v9h-11v-9zM2.5 6.5h11M2.5 9.5h11M6 3.5v9M10 3.5v9", hue: 110 },
  // Linked records — schema/ORM.
  schema: { path: "M2.5 3h5v3h-5V3zM8.5 10h5v3h-5v-3zM5 6v2.5a1.5 1.5 0 0 0 1.5 1.5h2", hue: 120 },

  /* --- Security --- */
  // Key — env and secrets.
  key: { path: "M10.5 3a2.5 2.5 0 1 1-2.2 3.7L3 12v1.5h2V12h1.5v-1.5H8l.3-.3A2.5 2.5 0 1 1 10.5 3z", hue: 45 },
  // Lock — lockfiles.
  lock: { path: "M4.5 7V5.5a3.5 3.5 0 0 1 7 0V7M3.5 7h9v6h-9V7z", hue: 0 },
  // Shield — certificates.
  shield: { path: "M8 2l5 2v4.5c0 2.6-2 4.4-5 5.5-3-1.1-5-2.9-5-5.5V4l5-2z", hue: 10 },

  /* --- Version control --- */
  // Fork — git.
  fork: { path: "M4.5 3.5v3a2 2 0 0 0 2 2h3a2 2 0 0 1 2 2v1M4.5 3.5a1.2 1.2 0 1 0 0-.1zM11.5 12.5a1.2 1.2 0 1 0 0-.1zM4.5 12.5a1.2 1.2 0 1 0 0-.1zM4.5 8v3.3", hue: 20 },
  // Crossed-out eye — ignore files.
  ignore: { path: "M2 8s2.5-3.5 6-3.5S14 8 14 8s-2.5 3.5-6 3.5S2 8 2 8zM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM3 13L13 3", hue: 35 },

  /* --- Per-language marks --- */
  // Coiled body — Python.
  python: { path: "M6 3.5h4a2 2 0 0 1 2 2V8H4v2.5a2 2 0 0 0 2 2h4M4 8V5.5a2 2 0 0 1 2-2M12 8v2.5a2 2 0 0 1-2 2M6.5 5.5h.01M9.5 10.5h.01", hue: 65 },
  // Faceted gem — Ruby.
  ruby: { path: "M4 2.5h8l2 3.5-6 7.5-6-7.5 2-3.5zM2 6h12M6 2.5L4.5 6 8 13.5 11.5 6 10 2.5", hue: 5 },
  // Speed lines + circle — Go.
  go: { path: "M2 6h3.5M1.5 8.5H5M8.5 4.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM11 8.5h2.5", hue: 195 },
  // Gear-cog ring — Rust.
  rust: { path: "M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM8 6.5h2a1.25 1.25 0 0 1 0 2.5H8v-2.5zM8 9v3M8 1.8v1.7M8 12.5v1.7", hue: 40 },
  // Steam cup — Java.
  java: { path: "M3.5 7h7v3.5a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V7zM10.5 8h1a1.5 1.5 0 0 1 0 3h-1M6 4.5c0-1 1-1 1-2M8.5 4.5c0-1 1-1 1-2", hue: 25 },
  // Elephant curve — PHP.
  php: { path: "M2 8c0-2.2 2.7-4 6-4s6 1.8 6 4-2.7 4-6 4H5l-.8 2M5.5 7h1.2a1 1 0 0 1 0 2H5.5V7zM9.5 7h1.2a1 1 0 0 1 0 2H9.5V7z", hue: 265 },
  // Bracket pair — C-family.
  cfamily: { path: "M6 3.5H4.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1H6M10 3.5h1.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H10M8 6.5v3M6.5 8h3", hue: 240 },
  // Swift bird stroke.
  swift: { path: "M3 3.5c4 3 7 5.5 9 9.5C9 12 5.5 10 3 7.5M11 3.5c1.5 2.5 2 5.5 1 8", hue: 30 },
  // Dart arrow.
  dart: { path: "M13 3l-8 3.5L3 11l4.5-2L11 13l2-10zM5 6.5L7.5 9", hue: 205 },

  /* --- Directories --- */
  // Closed folder.
  folder: { path: "M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7.5z", hue: 220 },
  // Open folder — leaning front face.
  folderOpen: { path: "M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V8M2 4.5V12a1 1 0 0 0 1 1h10l2-6H4.2a1 1 0 0 0-.95.68L2 12", hue: 215 },

  /* --- Fallback --- */
  // Plain page.
  page: { path: "M4 2.5h5l3 3v8H4v-11zM9 2.5V6h3", hue: 245 },
} satisfies Record<string, Glyph>;

/** Exact filename matches take priority over extensions. */
const BY_FILENAME: Record<string, Glyph> = {
  dockerfile: G.container,
  "docker-compose.yml": G.container,
  "docker-compose.yaml": G.container,
  ".dockerignore": G.ignore,
  ".gitignore": G.ignore,
  ".eslintignore": G.ignore,
  ".prettierignore": G.ignore,
  ".gitattributes": G.fork,
  ".gitmodules": G.fork,
  ".env": G.key,
  ".npmrc": G.gear,
  ".nvmrc": G.hexagon,
  ".node-version": G.hexagon,
  ".editorconfig": G.gear,
  ".eslintrc.json": G.gear,
  ".prettierrc": G.gear,
  "package.json": G.braces,
  "package-lock.json": G.lock,
  "pnpm-lock.yaml": G.lock,
  "yarn.lock": G.lock,
  "bun.lockb": G.lock,
  "cargo.lock": G.lock,
  "tsconfig.json": G.gear,
  "jsconfig.json": G.gear,
  "readme.md": G.markdown,
  "changelog.md": G.markdown,
  "license": G.bound,
  "makefile": G.play,
  "justfile": G.play,
  "turbo.json": G.nested,
  "pnpm-workspace.yaml": G.nested,
  "vite.config.ts": G.nested,
  "webpack.config.js": G.nested,
  "rollup.config.js": G.nested,
  "next.config.mjs": G.layers,
  "next.config.js": G.layers,
  "tailwind.config.ts": G.wind,
  "tailwind.config.js": G.wind,
  "schema.prisma": G.schema,
};

const BY_EXTENSION: Record<string, Glyph> = {
  // JS/TS
  ts: G.markup,
  mts: G.markup,
  cts: G.markup,
  js: G.markup,
  mjs: G.markup,
  cjs: G.markup,
  tsx: G.layers,
  jsx: G.layers,
  vue: G.layers,
  svelte: G.layers,
  astro: G.layers,

  // Structured data & config
  json: G.braces,
  jsonc: G.braces,
  json5: G.braces,
  yaml: G.gear,
  yml: G.gear,
  toml: G.gear,
  ini: G.gear,
  conf: G.gear,

  // Markup
  html: G.tag,
  htm: G.tag,
  xml: G.tag,
  ejs: G.tag,
  hbs: G.tag,

  // Styling
  css: G.droplet,
  scss: G.droplet,
  sass: G.droplet,
  less: G.droplet,
  styl: G.droplet,

  // Media
  svg: G.vector,
  ai: G.vector,
  png: G.image,
  jpg: G.image,
  jpeg: G.image,
  gif: G.image,
  webp: G.image,
  avif: G.image,
  ico: G.image,
  woff: G.glyphMark,
  woff2: G.glyphMark,
  ttf: G.glyphMark,
  otf: G.glyphMark,

  // Prose
  md: G.markdown,
  mdx: G.markdown,
  markdown: G.markdown,
  txt: G.lines,
  rst: G.lines,
  pdf: G.bound,

  // Shell & tasks
  sh: G.terminal,
  bash: G.terminal,
  zsh: G.terminal,
  fish: G.terminal,
  ps1: G.terminal,
  bat: G.play,
  cmd: G.play,

  // Data
  sql: G.cylinder,
  db: G.cylinder,
  sqlite: G.cylinder,
  prisma: G.schema,
  graphql: G.schema,
  gql: G.schema,
  csv: G.grid,
  tsv: G.grid,
  xlsx: G.grid,
  xls: G.grid,

  // Security
  env: G.key,
  pem: G.key,
  key: G.key,
  cert: G.shield,
  crt: G.shield,
  lock: G.lock,

  // Languages
  py: G.python,
  pyi: G.python,
  rb: G.ruby,
  gemspec: G.ruby,
  go: G.go,
  rs: G.rust,
  java: G.java,
  kt: G.java,
  kts: G.java,
  php: G.php,
  c: G.cfamily,
  h: G.cfamily,
  cpp: G.cfamily,
  cc: G.cfamily,
  hpp: G.cfamily,
  cs: G.cfamily,
  swift: G.swift,
  dart: G.dart,
};

/** Resolves the glyph a path maps to. Exported so file-tree/file-tabs can pre-resolve. */
export function glyphForFilename(filename: string): Glyph {
  const base = (filename.split("/").pop() ?? filename).toLowerCase();
  const exact = BY_FILENAME[base];
  if (exact) return exact;

  // `.env.local`, `.env.production` — the meaningful part is the prefix.
  if (base.startsWith(".env")) return G.key;
  if (base.startsWith("dockerfile")) return G.container;

  const ext = base.includes(".") ? (base.split(".").pop() as string) : "";
  return BY_EXTENSION[ext] ?? G.page;
}

/**
 * Hue is derived from the glyph, so every `.ts` file is the same colour
 * everywhere in the UI without callers having to pass one.
 */
export function hueForFilename(filename: string): number {
  return glyphForFilename(filename).hue;
}

const iconClass = css({
  display: "inline-block",
  flexShrink: 0,
  verticalAlign: "-0.125em",
});

export interface FileIconProps {
  filename: string;
  /** Pixel size of the square icon. */
  size?: number;
  /** Render in the surrounding text colour instead of the per-type hue. */
  muted?: boolean;
  /** Render a folder glyph instead of resolving `filename` to a file type. */
  variant?: "file" | "folder" | "folder-open";
  className?: string;
}

/** A file-type glyph, coloured by type. Pairs with file-tree and file-tabs. */
export function FileIcon({ filename, size = 16, muted = false, variant = "file", className }: FileIconProps) {
  const glyph =
    variant === "folder" ? G.folder : variant === "folder-open" ? G.folderOpen : glyphForFilename(filename);
  // Chroma/lightness chosen to stay legible on both the light and dark
  // surfaces without needing a second palette: mid-lightness, modest chroma.
  const color = muted ? "currentColor" : `oklch(0.62 0.15 ${glyph.hue})`;

  return (
    <svg
      className={className ? `${iconClass} ${className}` : iconClass}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={glyph.path}
        stroke={color}
        fill="none"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
