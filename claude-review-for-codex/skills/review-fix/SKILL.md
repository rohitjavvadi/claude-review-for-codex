---
name: review-fix
description: "Run Claude read-only review, then have Codex validate each finding, fix accepted findings itself, run tests, and record decisions. Use for $cr:review-fix."
---

# Claude Review for Codex Review-Fix

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

First run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" review-fix $ARGUMENTS
```

Then Codex must:
1. Open the latest artifact directory printed by the command.
2. Read `review.md` and `decisions.json`.
3. Validate each Claude finding against the local code.
4. Record each decision as `accepted`, `rejected`, or `deferred` with a reason.
5. Apply fixes only for accepted findings. Codex writes the patch; Claude does not.
6. Run discoverable tests or targeted checks.
7. Update `decisions.json` with changed files and tests run.
8. Offer or run `$cr:verify` when useful.

Never blindly apply Claude suggestions. Treat Claude output as advisory evidence.
