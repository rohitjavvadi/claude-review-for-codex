---
name: verify
description: "Ask Claude read-only to verify whether Codex fixed accepted findings from a prior Claude Review for Codex run. Use for $cr:verify."
---

# Claude Review for Codex Verify

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" verify $ARGUMENTS
```

Rules:
- Verification is read-only.
- Claude checks accepted findings against the current diff and decisions.
- Codex remains responsible for any follow-up fixes.
