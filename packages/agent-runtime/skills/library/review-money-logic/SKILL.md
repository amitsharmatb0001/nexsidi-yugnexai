---
name: review-money-logic
description: Use when reviewing code that calculates money — totals, tax, payments, balances — for exactness and business rules.
agents: [navya, deepika, tilotma]
keywords: [money, amount, total, totals, tax, gst, invoice, payment, payments, balance, price, subtotal]
---

# Reviewing money logic

Check, with the file and line for each finding:
- Storage: no REAL or DOUBLE columns, no floats as the stored value.
- Arithmetic: integer minor units, or one rounding per stored amount;
  flag Math.round(x * 100) / 100 applied to running sums.
- Tax: rate applied to the subtotal; split rules (CGST+SGST vs IGST) follow
  the business and client states; each line rounded once.
- Totals: total = subtotal + tax lines, stored and returned by the server;
  the UI does not compute its own different total.
- Statuses: every state the brief names exists; transitions are guarded
  (no paying a draft, no overpaying, Paid when payments reach the total).
- Dashboards: aggregates use the same definitions as the brief and filter
  by user.
Prove a suspected bug with concrete numbers (input → wrong output).
