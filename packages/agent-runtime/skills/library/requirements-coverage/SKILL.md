---
name: requirements-coverage
description: Use when turning a customer's brief into a plan or spec — every requirement must survive as an endpoint, field, page or rule.
agents: [planner, saanvi, arjun]
keywords: [build, app, create, manage, page, sign up, dashboard, i can, should, must]
---

# Requirements coverage

A spec that drops a requirement guarantees a missing feature. Before you
lock a plan or spec, walk the brief line by line and check each item lands
somewhere concrete. Real misses this skill exists for: "add, edit and delete
clients" planned with no edit or delete endpoint; "client has a state" with
no state column; detail pages planned with no endpoint that loads one record.

## Verbs become endpoints
| The brief says | You need |
| --- | --- |
| add / create X | POST /x |
| list / see all X | GET /x |
| X has a page / view X / details | GET /x/:id |
| edit / update / change X | PATCH /x/:id |
| delete / remove X | DELETE /x/:id |
| mark X as Y | PATCH /x/:id/status (or a named action) |
| search / filter X | query parameters on GET /x |
| settings / profile | GET and PATCH for the current user |

## Nouns become fields
Every attribute the brief lists ("name, email, phone, billing address,
state, optional GSTIN") is a column with the right type and nullability.
"Optional" means nullable; everything else is required.

## Rules become acceptance criteria
Each rule ("numbers run in order per account", "exact to the paisa",
"no other user can see my data") becomes a testable criterion in the spec,
worded so a tester can check it.

## Exact details stay word for word
When the brief gives an exact format, example, number or name, copy it
into the plan word for word — never paraphrase it into a general word.
"Invoice numbers run in order: INV-2026-0001, INV-2026-0002" must reach
the plan as that format, not as "sequential invoices" (a real build
produced INV-0001 because the format was paraphrased away). The same goes
for rates (18%), status names (Draft, Sent, Paid), units and limits.

## Before you finish
Re-read the brief once more and tick every sentence. If an item has no
endpoint, field, page or criterion, add it — do not drop it to keep the
spec short. Never add features the brief did not ask for.
