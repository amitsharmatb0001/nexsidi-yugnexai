---
name: charts
description: Use when an app shows figures over time or comparisons as a chart — accurate, readable charts without heavy libraries.
agents: [aanya, shubham]
keywords: [chart, charts, graph, trend, revenue, last 6 months, per month, monthly, analytics]
---

# Charts

- The API returns the exact series (one value per period, zero-filled for
  empty periods) — the chart never re-aggregates raw records.
- Draw with inline SVG in a client component (no chart library needed for
  bars or a line): bars for amounts per period, a line for a level over
  time.
- Label every period on the x-axis; format values with the app's money or
  number format; show the value on hover or above each bar.
- Start bar charts at zero; one accent colour; a faint grid; the latest
  period emphasised.
- Give the chart a title stating what it shows and the period, and an
  accessible text alternative (a visually hidden table or aria-label).
