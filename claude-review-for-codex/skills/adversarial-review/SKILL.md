---
name: adversarial-review
description: "Run a stricter adversarial Claude review focused on security, rollback, data loss, migrations, and race conditions. Use for $cr:adversarial-review."
---

# Claude Review for Codex Adversarial Review

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Before running the command, create `.codex/claude-reviews/input/codex-context.md` in the target repository unless the user already passed `--codex-context-file`. Keep it concise and include the user's adversarial focus, Codex's summary of the change, files/commits under review, tests/checks already run, known failure modes, rollback/data-loss/security concerns, and anything Claude should challenge.

Run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" adversarial-review --codex-context-file .codex/claude-reviews/input/codex-context.md $ARGUMENTS
```

Rules:
- Treat this as explicit opt-in to a deeper review mode.
- Claude still cannot write, patch, run arbitrary Bash, or change files.
- Codex remains the only writer/fixer.
- If the user supplies `--codex-context-file`, use their file path instead of creating/passing the default one.
