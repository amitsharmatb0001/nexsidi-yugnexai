---
name: data-isolation
description: Use when an app has user accounts and private data — every query scoped to the signed-in user, nothing leaks between users.
agents: [shubham, pranav, karan, navya, tilotma]
keywords: [private, privacy, my data, my clients, my invoices, user_id, account, accounts, sign up, multi-tenant, other user]
---

# Per-user data isolation

## Rules
- The user id comes ONLY from the verified JWT (req.user.id) — never from
  the request body, query or URL.
- Every table holding user data has user_id NOT NULL with an index.
- Every read filters by user: WHERE user_id = $1.
- Every read, update or delete of one record filters by id AND user:
  WHERE id = $1 AND user_id = $2. Zero rows → 404 (do not reveal that the
  record exists for someone else).
- Child records (invoice items, payments) are reached through a parent the
  user owns, or carry user_id too.
- Aggregates (dashboard totals, charts) filter by user_id as well.

## Test it
Create two users. As user B, request user A's record by id in the API and
open its page in the UI: both must fail with 404 and show none of A's data.
