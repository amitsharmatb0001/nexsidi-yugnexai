---
name: india-gst-invoicing
description: Use when an app issues invoices or bills with Indian GST — tax split, GSTIN, invoice numbering and totals.
agents: [planner, saanvi, arjun, shubham, aanya, pranav, navya, tilotma]
keywords: [gst, gstin, cgst, sgst, igst, invoice, invoicing, tax invoice, billing]
---

# Indian GST invoicing

## The tax split depends on place of supply
- Supplier state = the business's state (from its profile).
- Place of supply = the client's state.
- Same state (intra-state): charge CGST and SGST, each half the rate.
  At 18%: CGST 9% + SGST 9%.
- Different state (inter-state): charge IGST at the full rate (18%).
- Show each tax line separately on the invoice, then the grand total.
- If the brief asks for a single flat GST line, follow the brief; keep the
  state fields anyway so the split can be added later.

## Calculation (exact to the paisa)
- Work in integer paise. Line amount = quantity × rate (paise).
- Taxable value (subtotal) = sum of line amounts.
- Each tax line = round(subtotal × rate / 100) to the nearest paisa,
  half up. For a split, compute CGST and SGST separately; each is rounded.
- Total = subtotal + all tax lines. Never recompute the total from rounded
  floats or from the display string.
- Check: 2 × ₹12,500.00 + 3 × ₹4,999.00 → subtotal ₹39,997.00; 18% →
  ₹7,199.46 (or CGST ₹3,599.73 + SGST ₹3,599.73); total ₹47,196.46.

## GSTIN
- 15 characters: 2-digit state code, 10-character PAN, entity number,
  the letter Z, check character.
- Validate with: ^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$
- Store upper-case. Optional for clients unless the brief says otherwise.
- Common state codes: 07 Delhi, 09 Uttar Pradesh, 19 West Bengal,
  24 Gujarat, 27 Maharashtra, 29 Karnataka, 32 Kerala, 33 Tamil Nadu,
  36 Telangana.

## Invoice content
Business name, address, state and GSTIN; client name, address, state and
GSTIN if any; invoice number and dates; line items (description, quantity,
rate, amount); subtotal; each tax line with its rate; grand total.

## Invoice numbers
Sequential per account with no gaps or duplicates — see the
sequential-numbering skill.
