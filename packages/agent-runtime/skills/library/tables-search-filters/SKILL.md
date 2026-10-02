---
name: tables-search-filters
description: Use when building a list page with search, filters or sorting — server-side queries and a table that works on phones.
agents: [aanya, shubham]
keywords: [list, table, search, filter, filters, sort, pagination, find, invoices list, clients list]
---

# Tables, search and filters

## Backend
- GET /items?search=&status=&clientId=&from=&to=&page= — every filter is
  optional and they combine (AND).
- Search with ILIKE on the named fields using a parameter ($1), never string
  concatenation. Join to related tables for names (search invoices by
  client name).
- Always scoped to the user; ordered (newest first) and limited.

## Frontend
- Filters and search live in the URL query string, so refresh and back
  keep them.
- Debounce search typing (300 ms); show a clear "No results for …" state
  with a button to clear filters.
- Table on wide screens; under 640 px each row becomes a card with the key
  fields — never sideways scrolling.
- Money right-aligned in var(--font-mono); status as a coloured badge with
  text, not colour alone.
- Each row links to its detail page.
