---
name: typography
description: Use when styling text in a generated app — the in-house NexUI fonts through CSS variables and a clear type scale.
agents: [aanya, vanya]
keywords: [font, fonts, typography, typeface, heading, headings, text, look and feel, design]
---

# Typography with the in-house fonts

- Fonts are NexUI's own, loaded by the scaffold from /fonts: NexuiSans,
  Inter, JetBrains Mono, NexuiMono. Never link Google Fonts or any outside
  font, and never write a font name in a component.
- Use the variables: var(--font-display) for headings, var(--font-body) for
  text, var(--font-mono) for figures, codes and invoice numbers.
- One type scale for the whole app, for example 12 / 14 / 16 / 20 / 24 /
  32 / 40 px; headings 600–700 weight; body 400; labels 500 with a little
  letter-spacing.
- Identity comes from contrast in weight and size, spacing and the mono
  figures — not from another typeface.
- The in-house fonts have no rupee sign; the system fallback draws it, so
  always keep the full variable (never a single font name).
