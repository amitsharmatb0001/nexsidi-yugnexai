# Express Build test prompt — "tweaks on an existing app" (and two requests it must refuse)

Purpose: test Express Build for what it is — a template with tweaks. It starts from an app you already delivered (its backend, frontend and logic) and changes it. It is not a fresh build.
The earlier Stockroom prompt (`2026-10-08-express-build-test-prompt-stockroom.md`) is a whole new product. That belongs to the fresh build, not here. Run it against Express Build only to prove the refusal (Case 2 below).

Internal document. Do not paste the checks or the traps into the form.

---

## 1. How to run

1. Sign in with your own account (it must already hold at least one delivered project; the base here is **Ledgerly 2**).
2. Open Express Build. Run Case 1, then Case 2, then Case 3. One case at a time; note the start time, the finish time and the spend.
3. For Case 1 choose **Choose from my projects → Ledgerly 2** (so the base is not left to chance). Run it a second time with **Automatic** and the same text: the system should pick Ledgerly 2 on its own.
4. After Case 1 delivers, run Section 5 against the live app. Then Section 6.
5. Stop at once on: a repeated finding, a retry loop, or a run past 20 minutes (it should take a few minutes).

## 2. Case 1 — in scope (paste into the form)

**Project name:** Shopbill

**Describe the site:** Shopbill — GST invoices for small studios and shops in India.

**What you want:**

```
Make these changes to the app. Change nothing else.

1. Home page: the main headline becomes "GST invoices your accountant will thank you for". The line under it becomes "Made for small studios and shops. Every rupee exact to the paisa."
2. Colour: the main accent colour becomes a deep blue.
3. Remove the "comparison" section from the home page.
4. Add a public page called Pricing at /pricing with three plans: Solo at ₹0 a month, Studio at ₹499 a month, Firm at ₹1,499 a month. Add a "Pricing" link to the header, for people who are signed out and signed in.
5. An invoice gets an optional "PO reference" (text, up to 50 characters). It is typed when creating or editing an invoice, shown on the invoice screen, and printed on the invoice PDF.
```

## 3. Case 2 — out of scope, must be refused

Paste the Stockroom brief (Section 2 of `2026-10-08-express-build-test-prompt-stockroom.md`) with project name **Stockroom** and description "Stockroom — stock and purchase orders for small shops in India."

Expected: within about 30 seconds the page says **"Too big for Express Build"**, explains why, and says to narrow the request or use a fresh build. Nothing is created.

## 4. Case 3 — out of scope by size (a clear second example)

**Project name:** Shopbill Plus. **Describe the site:** Shopbill — GST invoices for small studios and shops in India.

**What you want:**

```
Add a stock module: a products list with SKU and stock level, a suppliers list, purchase orders with line items, stock history for every change, and a low-stock report. Add a screen for each.
```

Expected: refused in the same way (it needs more than 2 new tables and more than 5 new pages). Nothing is created.

## 5. Answer sheet — Case 1, against the live app

Use two sign-ups (A and B).

### 5.1 The five changes (P0)
- C1 Home page headline and the line under it read exactly as given. The old headline is gone.
- C2 The accent colour (buttons, links, focus) is a deep blue and passes 4.5:1 contrast with white text. Measure it.
- C3 The comparison section is gone from the home page, and nothing else on the page moved or broke.
- C4 `/pricing` opens while signed out (no redirect to sign-in), shows the three plans with the right amounts, and the header has a "Pricing" link signed out and signed in.
- C5 PO reference: create an invoice with "PO-7781" → it shows on the screen and on the PDF. A 51-character value is refused by the server. Empty is allowed. An invoice made before the change (none in a fresh app) is not required.

### 5.2 Nothing else changed (P0)
- R1 Sign up, sign in, sign out work. A wrong password is refused with no hint of whether the email exists.
- R2 Same-state invoice: 1 × ₹10,000.00 → CGST ₹900.00, SGST ₹900.00, total ₹11,800.00. Other-state: IGST ₹1,800.00, same total.
- R3 Invoice numbers run INV-2026-0001, INV-2026-0002… per user; a second user starts again at 0001.
- R4 Shop B cannot read, change or export shop A's clients or invoices (404).
- R5 The CSV export and the PDF still download and read correctly.
- R6 The existing pages, links and buttons still work (route sweep on desktop and at 375px: no sideways scroll, no clipped header).

### 5.3 It is a new app, not the old one (P0)
- N1 No trace of "Ledgerly" or the source project id in any page, in the page source, in the API responses, in file names, in docker names or in package names.
- N2 The folder and the Docker project are named `shopbill` (the app's name), and every published port is bound to 127.0.0.1.
- N3 `spec.json` describes Shopbill and the new request, not the source app. `user-request.txt` is the new request.
- N4 The database is fresh: none of the source app's accounts, clients or invoices exist.
- N5 None of the source app's pipeline files (agent histories, logs, QA notes) were copied.
- N6 Nothing starts by itself when Docker starts (no restart policy).

### 5.4 Build and delivery (P0)
- B1 It type-checks and builds, starts from one `docker compose up`, and the health check passes.
- B2 The two layers agree: the frontend calls only endpoints the backend registered (PO reference included).
- B3 After the system's own testing, every table holds only what was there before it started (no test accounts, no sample rows).

## 6. Scoring

| Group | Weight | Pass condition |
|---|---|---|
| P0 checks (5.1–5.4) | 60% | Every P0 check passes. One failure = the run does not pass |
| The refusals (Cases 2 and 3) | 15% | Both refused in under 60 s, with the message, creating nothing |
| Looks | 10% | Design review ≥ 7.0 on its own evidence; no leftover source branding |
| Process | 15% | See below |

Process checks (yes/no, noted in the run sheet):
1. Was the base picked correctly with "Automatic"?
2. Time from Start to delivered: under 10 minutes for Case 1?
3. Iterations wasted on blocked actions: none, or each one explained?
4. Spend is recorded for the run, and is a small fraction of a full build?
5. Did the system say what it changed, file by file, and was that true?
6. Did any review step claim something the run sheet later shows is untrue?

**Result words:** PASS (all P0 and both refusals, ≥ 90), PASS WITH NOTES (75–89), FAIL (any P0 failed, a refusal missed, or < 75). Record what the system's own review said about each failed check.

## 7. Why each trap is here (from real misses)

| Trap | Real miss it comes from |
|---|---|
| Public `/pricing` page | A new page redirected visitors to sign-in because the public-path list was not updated |
| One new field across database, backend, frontend and PDF | Backend and frontend each compiled, and disagreed on the endpoint (the wishlist run) |
| "Change nothing else" + regression checks | An edit pass that rewrote copy and layout it was not asked to touch |
| No trace of the source | The source project id survived in package names and files |
| Stockroom and the stock module | A request that replaced a whole product ran 18 minutes and ended in an error |
| Fresh database, no source data | Accounts and invoices of the source app carried into the clone |

## 8. Run sheet

- Case / base / start / finish / spend:
- Base picked (Automatic):
- Checks failed (id, what was seen, what the system said):
- Refusals (time, message, anything created):
- Blocked or wasted iterations:
- Result and the three most important fixes next:
