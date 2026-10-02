---
name: money-exact
description: Use whenever an app stores, calculates or shows money — prices, totals, tax, payments — so amounts are exact to the paisa or cent.
agents: [shubham, aanya, pranav, navya, deepika, tilotma]
keywords: [money, price, prices, amount, amounts, total, totals, tax, gst, invoice, payment, payments, rupee, ₹, currency, paisa, subtotal, billing]
---

# Exact money

## Store
- Integer minor units (paise) in BIGINT columns, or NUMERIC(14,2).
  Never REAL, DOUBLE PRECISION or JavaScript floats as the source of truth.
- pg returns NUMERIC as a string — convert to integer paise once per stored
  value (Math.round(Number(value) * 100)), never on running sums.

## Calculate
- Do every calculation in integer paise: line = quantity × ratePaise
  (round once if quantity can be fractional), subtotal = sum of lines,
  tax = Math.round(subtotal × rate / 100), total = subtotal + tax.
- Calculate on the server and store subtotal, tax and total. The frontend
  shows a live preview with the SAME function but the server's numbers win.
- Avoid the floating-point pattern Math.round(x * 100) / 100 applied
  repeatedly to running totals — errors accumulate at half-paisa edges.

## Show
- Format only at the edge: see the india-formats skill for rupees.
- Never parse a formatted string back into a number.

## Test with known values
Write tests with amounts whose answer you worked out by hand, including a
rounding edge (₹999.99 at 18% → tax ₹180.00, total ₹1,179.99).
