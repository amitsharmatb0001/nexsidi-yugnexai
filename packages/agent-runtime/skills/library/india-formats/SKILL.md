---
name: india-formats
description: Use when showing money, numbers or dates to Indian users — rupee grouping and date style.
agents: [aanya, shubham, navya, tilotma]
keywords: [india, indian, rupee, rupees, inr, ₹, lakh, crore, en-in, paisa]
---

# Indian number and date formats

## Money
- Indian digit grouping: ₹1,25,000.00 (lakh grouping), always 2 decimals.
- Use: new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })
  .format(paise / 100)
- Keep amounts as integer paise in state and API; format only for display.
- Show figures in the monospace font variable (var(--font-mono)) and
  right-align them in tables so digits line up.

## Dates
- Required style "12 Sep 2026". Do not rely on Intl month names: current
  locale data prints "Sept" for en-IN and en-GB. Format explicitly:
  const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`
- Parse date-only values ("2026-09-12") as local dates, not UTC, or they
  shift by a day: new Date(y, m - 1, d).
- "This month" boundaries use the user's local month (Asia/Kolkata for
  Indian users), on the server and in the browser.
