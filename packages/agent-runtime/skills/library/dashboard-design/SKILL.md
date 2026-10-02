---
name: dashboard-design
description: Use when building a dashboard or overview page — key figures, recent activity and what needs attention.
agents: [aanya, vanya, shubham]
keywords: [dashboard, metrics, overview, summary, kpi, analytics, at a glance, total invoiced, totals]
---

# Dashboard

## Layout
- Top: 3–4 key figure cards. Each card: a short label, the value in
  var(--font-mono) and large, and one line of context ("this month",
  "3 invoices").
- Then what needs attention (overdue, unpaid, drafts) as a short list with
  a link to each item.
- Then recent activity (latest records) with a link to the full list.
- One primary action in the page header (New invoice, Add plant).

## Numbers must be exact
- Compute every figure on the server with SQL aggregates scoped to the user
  (SUM(...) FILTER (WHERE status = ...)), with the period boundaries in the
  user's time zone. The page shows what the API returns — no re-adding in
  the browser.
- Each figure's definition matches the brief word for word ("total unpaid"
  = sent but not paid, not drafts).

## States
Empty account: welcoming empty state with the first action as a button.
Loading: skeleton cards in the same layout. Error: message with Retry.
