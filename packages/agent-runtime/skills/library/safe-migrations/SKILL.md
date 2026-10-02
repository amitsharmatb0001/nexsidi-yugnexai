---
name: safe-migrations
description: Use when creating or changing database tables — keys, indexes, constraints and migrations that apply cleanly.
agents: [pranav, shubham]
keywords: [migration, migrations, schema, table, tables, column, columns, database, postgres, index]
---

# Safe migrations (PostgreSQL 16)

- Every table: id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at and updated_at TIMESTAMPTZ NOT NULL DEFAULT now().
- Foreign keys with explicit ON DELETE (CASCADE for owned children such as
  invoice items; RESTRICT where deleting would lose history, for example a
  client with invoices, or a soft delete).
- Index every foreign key and every user_id column.
- Unique constraints that encode business rules, for example
  UNIQUE (user_id, invoice_number).
- Money: BIGINT paise or NUMERIC(14,2) — see money-exact.
- Status columns: TEXT with a CHECK (status IN (...)) listing every state.
- Migrations are additive and run in order on an empty database without
  manual steps; adding a NOT NULL column to a table with rows needs a
  DEFAULT or a backfill in the same migration.
