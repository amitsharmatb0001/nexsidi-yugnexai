---
name: sequential-numbering
description: Use when records need human-readable running numbers per account (INV-2026-0001, ORD-0042) with no gaps or duplicates.
agents: [shubham, pranav, navya, arjun]
keywords: [invoice number, invoice numbers, order number, sequential, running number, numbering, serial, inv-]
---

# Sequential numbering per account

## Rule
Each account has its own sequence. Two requests at the same moment must
never get the same number, and a failed insert must not burn a number.

## Pattern (PostgreSQL)
- Table: counters(user_id, scope, last_value, PRIMARY KEY (user_id, scope)).
- In ONE transaction with the record insert:
  INSERT INTO counters (user_id, scope, last_value) VALUES ($1, 'invoice', 1)
  ON CONFLICT (user_id, scope) DO UPDATE SET last_value = counters.last_value + 1
  RETURNING last_value;
  then insert the record with the formatted number.
- Unique constraint on (user_id, invoice_number) as the last safety net.
- Format: `INV-${year}-${String(n).padStart(4, "0")}`.

## Never
- SELECT MAX(number) + 1 (two requests read the same max).
- COUNT(*) + 1 (gaps and duplicates after deletes).
- A global sequence shared by every account (numbers leak between users).
