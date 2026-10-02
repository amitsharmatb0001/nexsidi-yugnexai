---
name: forms-and-line-items
description: Use when building create or edit forms, especially forms with repeating rows (invoice line items) and live totals.
agents: [aanya]
keywords: [form, forms, create, edit, add, line item, line items, new invoice, settings, input]
---

# Forms and line items

- Every field has a visible label; required fields marked; helpful
  placeholder examples.
- Submit with type="submit" on a form with onSubmit — never also onClick
  (the request is sent twice).
- Disable the submit button while saving and show progress; on success go
  where the user expects (the new record's page or the list).
- Show the server's 400 message next to the field it names; keep what the
  user typed.
- Edit forms load the current values first and send only changed fields
  (PATCH).

## Repeating rows (line items)
- Start with one row; "Add item" adds a row; each row can be removed
  (keep at least one).
- Row fields: description, quantity, rate; the row amount updates live.
- Below the rows: subtotal, each tax line, total — calculated with the
  same function the server uses (money-exact), in integer paise.
- The server recalculates on save; show the saved values afterwards.
