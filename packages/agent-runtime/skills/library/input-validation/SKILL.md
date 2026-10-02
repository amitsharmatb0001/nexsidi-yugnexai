---
name: input-validation
description: Use when an API accepts user input — validate every field on the server with clear 400 errors.
agents: [shubham, karan, aanya]
keywords: [validation, validate, input, form, forms, create, update, required, email, phone, gstin]
---

# Server-side input validation

- Validate on the server for every POST and PATCH, even when the form
  validates too. Use one zod schema per request body.
- Trim strings; reject empty required fields; enforce max lengths.
- Numbers: quantity > 0, rate >= 0, finite, sensible maximums.
- Emails with a real email check; phone digits with an optional +country
  prefix; GSTIN with the india-gst-invoicing regex.
- Dates: valid ISO dates; due date on or after issue date.
- IDs in the URL: valid UUIDs, else 400 (or 404) — never a 500.
- Respond 400 with { success: false, error: "<field>: <what is wrong>" } so
  the form can show the message next to the field.
- PATCH accepts partial bodies: validate only the fields sent, never
  overwrite missing fields with null.
