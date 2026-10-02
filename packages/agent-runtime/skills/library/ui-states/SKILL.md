---
name: ui-states
description: Use for every page that loads data — designed loading, empty and error states, never a blank or broken page.
agents: [aanya]
keywords: [page, pages, list, dashboard, detail, loading, empty, error, no data]
---

# Loading, empty and error states

- Loading: a skeleton in the same layout as the content (NexUI Skeleton),
  or the button's isLoading for actions. Never a blank page.
- Empty: an icon or small illustration, one sentence saying what will
  appear here, and the primary action as a button ("Create your first
  invoice").
- Error: what went wrong in plain words and a Retry button. A 401 sends
  the user to sign in (see auth-flows).
- Not found: a designed 404 with a way back, for unknown routes and for
  records that do not exist or are not the user's.
- Never show raw JSON, stack traces or "undefined".
