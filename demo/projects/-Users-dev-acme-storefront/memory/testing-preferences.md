---
name: Testing preferences
description: Use vitest, run the suite before every commit, no snapshot tests
metadata:
  type: feedback
---

Run `npm test` (vitest) before every commit, and fix failures before moving on.

**Why:** a broken checkout test once reached production because the suite was skipped.
**How to apply:** prefer explicit assertions over snapshot tests; the user finds snapshots hard to review.
