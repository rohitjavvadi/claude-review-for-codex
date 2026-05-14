---
name: adversarial-review
description: "Run a stricter adversarial Claude review focused on security, rollback, data loss, migrations, and race conditions. Use for $cr:adversarial-review."
---

# Claude Review for Codex Adversarial Review

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" adversarial-review $ARGUMENTS
```

Rules:
- Treat this as explicit opt-in to a deeper review mode.
- Claude still cannot write, patch, run arbitrary Bash, or change files.
- Codex remains the only writer/fixer.
