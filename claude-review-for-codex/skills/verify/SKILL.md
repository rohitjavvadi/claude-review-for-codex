---
name: verify
description: "Ask Claude read-only to verify whether Codex fixed accepted findings from a prior Claude Review for Codex run. Use for $cr:verify."
---

# Claude Review for Codex Verify

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Before running the command, create `.codex/claude-reviews/input/codex-context.md` in the target repository unless the user already passed `--codex-context-file`. Keep it concise and include what Codex fixed, tests/checks run after the fix, any findings intentionally rejected/deferred, and any remaining uncertainty.

Run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" verify --codex-context-file .codex/claude-reviews/input/codex-context.md $ARGUMENTS
```

Rules:
- Verification is read-only.
- Claude checks accepted findings against the current diff and decisions.
- Codex remains responsible for any follow-up fixes.
- If the user supplies `--codex-context-file`, use their file path instead of creating/passing the default one.
