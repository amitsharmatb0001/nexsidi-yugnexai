# Ledgerly 2 (project 52c4d13c5e0d) — full user-flow test and system report
Date: 2026-10-06. Tested by hand against the live app (localhost:3200 / 3300) with two real accounts, a real browser at 1280×800 and at phone width (375px). All test data was removed afterwards (row counts back to zero except two old rows noted at the end).

## 1. Result against the locked spec (13 success criteria)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Sign up / sign in / sign out, business profile (name, address, state, GSTIN, bank, UPI) | **Met** | Duplicate email 409, weak password 400, wrong password 401 with no detail leak, forged token 401, invalid GSTIN 400, password hash never returned. Sign-out works in the UI (cookie cleared, protected pages redirect). The spec also lists `POST /auth/sign-out`; the app has no such endpoint (404) — the UI does not need it. |
| 2 | Client add / edit / view / delete, Indian states, optional GSTIN | **Met** | Created, edited, listed, deleted (a client with invoices is refused with a clear message — sensible). Invalid client refused. |
| 3 | Client page: details + all their invoices | **Met** | Checked through the API and the UI. |
| 4 | Sequential numbers INV-2026-0001…, per account, April-1 reset | **Met** | 0001, 0002 without gaps; a second user starts at 0001; issue date 31 Mar 2027 → INV-2026-0002, 1 Apr 2027 → INV-2027-0001, then 0002; an earlier date goes back to the old year's sequence. |
| 5 | GST exact to the paisa; 9%+9% same state, 18% IGST other state | **Partly** | Exact to the paisa (3×₹33.33 + 2×₹499.99 → subtotal 1099.97, IGST 197.99, total 1297.96); tiny amounts never invent or lose money; negative rate, zero quantity, no items, due date before issue date and unknown client are all refused. **Bug:** if the business state is not set, the backend still creates the invoice and silently assumes IGST (HTTP 201). The page now shows "choose a client / set your state", but the server does not refuse. |
| 6 | Draft → Sent → Paid | **Met** | Through the API and the UI buttons; an invalid status is refused. |
| 7 | Dashboard: invoiced this month, paid, unpaid, latest invoices | **Met** | Totals add up exactly to the invoices created. |
| 8 | Search by invoice number or client name | **Met** | API and UI; no-match gives an empty state; SQL-injection text returns nothing and no error. |
| 9 | PDF invoice with line items, SAC, tax breakup, bank and UPI | **Partly** | A valid PDF downloads, but it is plain monospaced text: amounts as "Rs.1180.00" (no ₹, no Indian digit grouping), dates as 2026-10-06 (not "12 Sep 2026"), UPI shown but no bank account number or IFSC. Not the "polished, trustworthy" document the brief describes. |
| 10 | CSV export for CA filing | **Met** | Header + one row per invoice, amounts in rupees (1000.00 / 90.00 / 90.00 / 1180.00). |
| 11 | Indian number format and date format | **Met** (screens) | ₹1,25,000.00, ₹1,47,500.00, 12 Sep 2026, 12 Oct 2026 on dashboard, list and detail. (Not met in the PDF — see 9.) |
| 12 | Data isolation between users | **Met** | User B got 404 on A's client, invoice, PDF, edit, delete and status change; B could not create an invoice for A's client; B's lists held only B's own records; A's data was untouched. |
| 13 | Distinct visual identity, emerald/slate, mobile responsive | **Partly** | Identity is strong (slate #0F172A, emerald #059669; design review 8.5 / 8.0 / 9.0 / 9.5). **Phone layout is broken** — see below. |

**Score: 10 of 13 fully met, 3 partly met, none missing.**

### Phone layout (brief: "It must work well on a phone")
At 375px every signed-in page is about 120px wider than the screen. The header menu does not fit: the logo touches the links and **"Settings" and "Sign Out" are off-screen** (a phone user cannot sign out without scrolling sideways). Tables are 495–526px wide. Nothing in the review pipeline ever tested a phone width — the browser worker is fixed at 1280×800.

### Fixed during this session (verified live)
- Table headers on the invoice form, list and preview were almost invisible (light background colour used as text colour) — fixed, 4 one-line changes.
- The new-invoice page showed "IGST (18%)" before any client was chosen — fixed (shows "choose a client"). The surgical edit was checked by diffing the whole frontend before and after: only the invoices folder changed.
- Earlier in the session: cookie flags, state list (10 → 36), GSTIN whitespace, junk files, rate limiting on sign-in/sign-up (installed but never applied), contrast, dropdown hidden behind a modal.

## 2. How accurate were the system's own reviews?

Counts from this run (8 review rounds, 13 worker runs, total spend **$66.86**):

**Real defects the system found (good):** GSTIN whitespace, states list of 10, cookie without SameSite/Secure, junk files (cat.exe etc.), missing rate limiting (found by 1 of 4 passes), text contrast 1.18:1 and the dropdown behind the modal (found once the design reviewer was given real screenshots).

**False or wrong findings the system produced (bad):**
- "Draft → Paid" flagged as a bug although the spec explicitly allows it.
- A colour check that read only 7 old variable names and sent the builder to "fix" a correct theme.
- The sign-up check judged a working form broken after a fixed 4-second wait.
- One wrong claim by the evidence collector (/api/invoices 404; real path /api/v1/invoices).
- The design evaluator described screenshots it was never shown and invented scores (5/4/6/7) — it ran on a text-only model.

**Real defects the system passed or never checked (worse):**
- Rate limiter installed but unused — missed by 3 of 4 code-review passes.
- Invisible table headers, IGST shown before a client is chosen — passed, with a design score of 8.55.
- Backend silently assuming IGST when the business state is not set — still open.
- Phone layout — never tested at all.
- PDF quality / dates / bank details — not checked.
- Test accounts on a non-reserved domain left in the database (2 rows).

**Honest reading:** the reviews catch about half of what a careful human pass finds. They are strongest on code-level and measurable things (contrast, missing validation) once they are given real evidence (screenshots, measurements). They are weakest on anything nobody told them to test (phone width, PDF contents, unit and rounding conventions, "what happens when a setting is empty").

## 3. System performance
- Cost: $66.86 for one app, of which about $9 was wasted on loops and re-reviews that the guards now prevent (a 2-hour retry cycle on 5 Oct cost $1.41 for nothing; full re-reviews after a one-file change cost about $2 each until the review cache was made per-file).
- Time: five working days from first build to a passing live review, mostly diagnosing the system itself rather than the app.
- Reliability fixes this session: Gemini 3.6–3.8-flash reject a screenshot or notice in the same turn as tool results (400) — fixed; NIM models queue for minutes — bypassed with NIM_ENABLED=false; the app's own sign-in limiter blocked the review account — fixed by waiting out Retry-After.

## 4. What I would do next (in order)
1. Fix the phone layout (header menu + tables) and add a phone-width pass to the live review (free: a second viewport in the route sweep, checking horizontal overflow and clipped header items).
2. Make the backend refuse invoices when the business state is not set (clear 400), and add a flow test to the pipeline that runs the checks used here (units, rounding, numbering, isolation, formats) automatically.
3. Rebuild the PDF properly (₹, Indian grouping, "12 Sep 2026", bank account + IFSC + UPI) and compare it with the brief.
4. Remove the two old test rows (deploy_check_1@test.com and its client) — needs the owner's go-ahead.
