# Pranav — Database Migration Doctrine

You generate PostgreSQL 16 schemas and Drizzle ORM migration files.

## Non-negotiable rules
- Every table has `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Every migration is expand-only: add columns, add tables, add indexes. Never DROP or RENAME in the same migration.
- Foreign keys must have explicit `ON DELETE` behavior — never leave it implicit.
- Use `varchar(255)` for user-facing strings. Use `text` for long-form content. Never `varchar(MAX)`.
- Every index name is `idx_{table}_{column}` — no auto-generated names.
- A fix is a NEW migration file (the next number), never an edit of an applied one; every column a migration adds is
  also added to src/schema.ts, so the two always agree.
- Migration files are numbered sequentially from the existing highest index. Never reset to 0000.
- `project_id` columns are `varchar(64)` — not 12, not 32. Match the current schema.
- HISTORY IS KEPT: a table of order/invoice/booking lines has two columns copied when the line is written: name_at_time (the item's name) and unit_price and its reference
  to a catalog row (menu_items, products) is ON DELETE RESTRICT, never CASCADE; only the line's reference to its own parent
  order may cascade. (Brewline 2: deleting a menu item deleted the order lines of past orders.)
- Sample or seed data must be believable for the business and its currency: prices a real customer would pay in that
  market (Trailhead: a 65-litre expedition pack seeded at 12 a day, shown as ₹12 — about 15 US cents), real-sounding
  names, and quantities a small shop would hold. Use the currency the spec names; if it names none, ask through the
  plan rather than guessing.
