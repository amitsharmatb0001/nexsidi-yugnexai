# Express Build test prompt — "Stockroom" (stock and purchase orders for small shops in India)

Purpose: one fresh, realistic customer request that tests the whole Express Build (Next.js + Express + PostgreSQL, custom JWT, local Docker delivery) end to end, and a written answer sheet so the result can be judged by facts, not by feel.
It is built from what went wrong on Ledgerly 2: every "trap" below maps to a real defect the system's own reviews passed.
This is a different app on purpose (not Ledgerly, Cardwise, NexTech or a task manager), so a reused or remembered build cannot pass it.

Internal document. Do not show the trap list or the answer sheet to the build.

---

## 1. How to run it

1. Use a new project. Paste **Section 2 only** (the customer's brief) as the user request. Nothing else from this file goes in.
2. Let the requirements step ask its questions. Answer only from **Section 3** (the customer's answers), word for word. If it asks something that is not in Section 3, answer "your call, keep it simple" and note the question in the run sheet (Section 7).
3. Approve the spec only if it matches Section 2 and Section 3. Record anything it invented that the customer never said (Section 7, "invented requirements").
4. Run with a hard spend cap (suggested: $40) and the stop-on-repeat watchdog. Stop at once on: a repeated finding, a quota-watch loop, or a retry cycle.
5. When it delivers, run **Section 5** against the live app (the checks are written so each has an exact expected value), then **Section 6** to score it.

## 2. The customer's brief (paste this)

Build Stockroom — stock and purchase orders for small shops in India.

Accounts and shop profile
- I sign up with my email and a password, then sign in and out.
- In Settings I enter my shop name, address, state, GSTIN and phone. My purchase orders use these details.

Suppliers
- I add, edit and delete suppliers: name, phone, email, address, state, and an optional GSTIN.
- Each supplier has a page with their details and all their purchase orders.

Products
- I add, edit and delete products: name, SKU (unique within my shop), unit (pcs, kg, litre or box), purchase price per unit in rupees, GST rate (0, 5, 12, 18 or 28 percent), reorder level, and the current stock.

Purchase orders
- I create a purchase order for a supplier with as many lines as I need: product, quantity, price per unit. Quantity can have decimals for kg and litre.
- Each order has an order date and an expected date.
- GST is worked out per line from the product's GST rate. If my shop's state and the supplier's state are the same, the tax is split into CGST and SGST; otherwise it is IGST. Show each line's tax, the subtotal, the total tax and the total. Money must be exact to the paisa.
- Order numbers run in order per shop: PO-2026-0001, PO-2026-0002, and so on. The financial year starts on 1 April and the numbering starts again then.
- Every order is Draft, Ordered, Received or Cancelled. I can mark a Draft as Ordered, an Ordered one as Received or Cancelled, and a Draft as Cancelled.
- When I mark an order Received, its quantities are added to the products' stock. A Received order cannot be changed or cancelled. A Cancelled order cannot be received.

Stock
- Stock can never go below zero.
- I can adjust a product's stock by hand with a reason (damage, count correction, other). Every change to stock, from an order or by hand, is kept in that product's stock history with the date, the amount and the reason.

Dashboard
- Stock value (stock × purchase price, added up), the products at or below their reorder level, how many orders are open (Draft or Ordered) and their total value, and my latest orders.

Finding things
- Search products by name or SKU. Search orders by number or supplier name.

Exports
- Download a purchase order as a PDF I can send to the supplier. Download a CSV of orders for my accountant, and a CSV of current stock.

Look and feel
- Amounts in rupees with Indian digit grouping (₹1,25,000.00). Dates like 12 Sep 2026.
- I use this standing in the shop on my phone, so it must work well on a phone.
- It must look calm, clear and trustworthy, like a finished product from a senior team — not a template, not a demo.
- My data is private: no other shop can ever see my suppliers, products or orders.

## 3. The customer's answers (give only when asked, word for word)

| If it asks about… | The customer says |
|---|---|
| Several users per shop | "No. One login per shop for now." |
| How tax is rounded | "Each line's tax is the line amount times the rate, rounded to the nearest paisa, halves round up. For same-state, CGST is half of that line's tax and SGST is the other half. If the tax has an odd paisa, CGST gets the extra paisa. The total tax is the sum of the lines' taxes." |
| Deleting a product or supplier that is on an order | "Not allowed. Tell me why." |
| What happens to an order's prices if I later change a product's price | "Nothing. The order keeps the price it was made with." |
| Currency | "Rupees only." |
| PDF contents | "My shop name, address, GSTIN and phone at the top; the supplier's details; the lines with per-line tax; the totals; the order number and dates." |
| Business state not set | "I must set it before I can make an order. Tell me clearly." |
| Colours or style | "Calm and trustworthy. Deep green or deep blue, white cards. No purple, no playful look." |
| Anything about roles, invites, payments, emails, SMS, barcodes, multiple shops | "Not now." |

## 4. Traps — why each exists (each was a real miss on Ledgerly 2)

| Trap in the brief | What it checks | Ledgerly 2 miss it comes from |
|---|---|---|
| Money "exact to the paisa" with decimals in quantity and price | Units end to end: stored value, API value, screen, PDF and CSV all agree (no rupee/paise mix-ups, no rounding to whole rupees) | Whole-rupee and paise confusion risk across layers |
| Tax rounding rule given only if asked | The system asks instead of guessing | "Never compute from an assumed value" |
| "Business state not set" | The server refuses to make an order and says why — it does not assume a tax type | Backend silently assumed IGST (HTTP 201) |
| Status rules with "cannot" statements | Illegal moves are refused by the server, not just hidden by the screen | Only valid transitions tested |
| "Stock can never go below zero" | A hard rule enforced on the server under repeated or simultaneous requests | Race conditions were never tested |
| "Works on a phone … standing in the shop" | 375px width: no sideways scroll, every menu item reachable, tables scroll inside their own box | Header items off-screen, every page 120px too wide |
| PDF "I can send to the supplier" | A real, readable document with ₹, Indian grouping, "12 Sep 2026" dates, GSTIN, per-line tax | Plain text, "Rs.", ISO dates, missing bank details |
| FY numbering reset on 1 April | Number follows the order date, per shop | Worked, kept as a regression check |
| Shop-private data | 404 on every cross-shop read, edit, delete, export | Worked, kept as a regression check |
| Search on name/SKU/number | Works; hostile text returns nothing and no error | Worked, kept as a regression check |
| Table-heavy screens on a phone | Wide tables do not push the page wider than the screen | Tables 495–526px on a 375px screen |
| Readable text everywhere | Contrast at least 4.5:1 for body text; no light tint used as text colour | Table headers and subtitles almost invisible |

## 5. Answer sheet — run these against the live app

Use two shops (A and B) with two separate sign-ups. Money below is in rupees; check the stored/API units are consistent with what the screen shows.

### 5.1 Accounts and profile (P0)
- A1 Sign up works; the same email again is refused (409/400); a one-character password is refused; a wrong password gives 401 with no hint of whether the email exists; a forged token gets 401.
- A2 Settings save and read back: shop name, address, state, GSTIN, phone. An invalid GSTIN is refused. The password hash is never returned.
- A3 Sign-out through the screen clears the session and a protected page then goes to sign-in.

### 5.2 Suppliers and products (P0)
- S1 Create two suppliers: "Same-State Supplier" (same state as the shop) and "Other-State Supplier" (different state, with GSTIN). Invalid supplier (empty name, bad email, unknown state) is refused.
- S2 Edit, list, delete. A supplier with orders cannot be deleted and the message says why.
- P1 Create products with SKU unique per shop: a duplicate SKU in the same shop is refused; the same SKU in shop B is allowed.
- P2 Unit must be one of pcs, kg, litre, box; GST rate one of 0, 5, 12, 18, 28; anything else is refused. Negative price or stock is refused.
- P3 A product on an order cannot be deleted.

### 5.3 Purchase orders — exact values (P0)
Create products: **Widget** (pcs, ₹149.99, 12%), **Rice** (kg, ₹40.00, 5%), **Pen** (pcs, ₹3.33, 18%), **Pin** (pcs, ₹0.05, 5%), **Anvil** (pcs, ₹1,250.00, 0%).

- O1 Same-state order: 7 × Widget, 2.5 kg × Rice, 10 × Pen →
  Widget line ₹1,049.93, tax ₹125.99 (CGST ₹63.00, SGST ₹62.99);
  Rice line ₹100.00, tax ₹5.00 (CGST ₹2.50, SGST ₹2.50);
  Pen line ₹33.30, tax ₹5.99 (CGST ₹3.00, SGST ₹2.99);
  **Subtotal ₹1,183.23 · total tax ₹136.98 · total ₹1,320.21**.
- O2 Other-state order with the same lines → IGST ₹125.99 / ₹5.00 / ₹5.99; same subtotal, tax and total as O1.
- O3 1 × Pin → line ₹0.05, tax ₹0.00, total ₹0.05 (no money invented or lost).
- O4 100 × Anvil → ₹1,25,000.00, tax ₹0.00, total ₹1,25,000.00 on screen with Indian grouping.
- O5 Refused with a clear message: zero or negative quantity, negative price, no lines, expected date before order date, unknown supplier, a product that is not the shop's own.
- O6 **Shop state not set** (use a third fresh shop): creating an order is refused (400) with a message that says to set the state in Settings. No order number is consumed.
- O7 Numbers: first order PO-2026-0001, second PO-2026-0002 with no gap; shop B starts at PO-2026-0001. Order date 31 Mar 2027 → PO-2026-000N; 1 Apr 2027 → PO-2027-0001; then PO-2027-0002.
- O8 Changing a product's price afterwards does not change an existing order's lines or totals.

### 5.4 Status and stock (P0)
Start: Widget stock 10.
- T1 Draft → Ordered → Received works; stock becomes 10 + 7 = 17; the Widget's stock history shows +7 with the date and the order number.
- T2 Received twice is refused (stock stays 17). A Received order cannot be edited or cancelled (refused). A Cancelled order cannot be received. Draft → Received directly is refused. An unknown status is refused.
- T3 Manual adjustment −5 with reason "damage" → stock 12, history row with the reason. Adjustment −13 (would go below zero) is refused and stock stays 12. An adjustment with no reason is refused.
- T4 **Concurrency:** send 20 simultaneous adjustments of −1 to a product with stock 10 → exactly 10 succeed, 10 are refused, final stock is exactly 0 (never negative, never more than 10 removed).

### 5.5 Dashboard, search, client page (P0)
- D1 Stock value = Σ(stock × purchase price) over all products, to the paisa. Low-stock list = products with stock ≤ reorder level. Open orders = count and total value of Draft + Ordered orders. Latest orders listed. Compute the expected numbers from the data you created and compare.
- D2 Search products by part of the name and by SKU; search orders by number and by supplier name; no match gives an empty state; `' OR 1=1 --` returns nothing and no error.
- D3 The supplier page shows their details and all their orders.

### 5.6 Exports (P0)
- E1 PO PDF downloads as a real PDF and **reads correctly**: shop name, address, GSTIN, phone; supplier details; every line with quantity, price and per-line tax; totals; the order number; dates shown like "12 Sep 2026"; amounts with ₹ (or "INR") and Indian grouping. Open it and look at it — a block of raw text lines is a fail.
- E2 Orders CSV: header plus one row per order; amounts in rupees with two decimals; the O1 row shows 1183.23 / 136.98 / 1320.21 (not 11.83 or 118323).
- E3 Stock CSV: one row per product with SKU, name, unit, stock, price and stock value; values match the screen.

### 5.7 Privacy (P0)
- X1 Shop B gets 404 (not 403 with data, not 200) on shop A's supplier, product, order, PDF, CSV row, stock history; cannot edit, delete, change status or adjust stock on them; cannot make an order for A's supplier or with A's products; B's lists contain only B's own records; A's data is unchanged afterwards.

### 5.8 Phone and looks (P0 for the phone, P1 for looks)
- M1 At 375px wide, on every page signed out and signed in: the page is not wider than the screen, every header link and button is reachable (no item off-screen), tables scroll inside their own box, buttons are easy to tap, forms are usable, nothing overlaps.
- M2 Text contrast at least 4.5:1 for normal text on every page (measure it); no light tint used as a text colour; headers of tables readable.
- M3 Design review: a distinct, calm visual identity as asked; no purple gradients, no template look, no leftover library branding. Screenshots of every page at desktop and at 375px are attached to the run sheet.
- M4 Formats: ₹1,25,000.00 and "12 Sep 2026" style everywhere on screen.

### 5.9 Clean handover (P0)
- C1 After the system's own testing, every table holds no more rows than before it started (row counts compared), including test accounts, sample records and stock history.
- C2 No leftover test files, scratch scripts or downloaded binaries in the project folders.
- C3 The app starts from one `docker compose up` and the screen opens on the stated port.

## 6. Scoring

| Group | Weight | Pass condition |
|---|---|---|
| P0 checks (all of 5.1–5.7, M1, C1, C3) | 60% | Every P0 check passes. One failed P0 check = the build does not pass. |
| Money exactness (O1–O4, E2, D1) | 15% | Every value matches to the paisa across screen, API, PDF and CSV |
| Phone and looks (M1–M4) | 10% | M1 and M2 pass; design review ≥ 7.0 on its own evidence |
| Process | 15% | See below |

Process checks (each scored yes/no and noted in the run sheet):
1. Did the requirements step ask about the rounding rule, the one-user rule, deleting used products, and a state that is not set — instead of guessing? (Section 3 lists the answers.)
2. Did the locked spec contain anything the customer never said? (List each; a few harmless defaults are fine, an invented feature is not.)
3. Did the review steps find real defects (list them) and flag false ones (list them)?
4. Did any review step claim something the run sheet later shows is untrue (a made-up score, an unseen screenshot, a wrong URL)?
5. Total spend under the cap; no wasted loop; no unexplained restarts.
6. Time from request to a passing delivery.

**Result words:** PASS (all P0 pass, ≥ 90 points), PASS WITH NOTES (all P0 pass, 75–89), FAIL (any P0 failed or < 75). Always record what the system's own review said about each failed check — the gap between what it passed and what you found is the most important output of the test.

## 7. Run sheet (fill in during the run)

- Project id / date / spend cap: 
- Questions the system asked (and the answer given): 
- Questions it should have asked but did not: 
- Invented requirements in the spec: 
- Review findings that were real / false: 
- Checks failed (id, what was seen, what the system's review had said): 
- Spend, wall-clock time, restarts or loops: 
- Result and the three most important fixes to make next: 

## 8. Optional second round (once round one passes)

Run the same brief again but change one thing, to check the build is not a memory of the first one: the customer is now a café (rename "products" to "ingredients", units to kg / litre / dozen, "suppliers" to "vendors") and adds one rule — "an ingredient below its reorder level shows a red badge". Run only the P0 checks that the change affects.
