---
name: review
description: "Run a read-only Claude Code review of the current git diff. Use for $cr:review, including --background."
---

# Claude Review for Codex Review

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" review $ARGUMENTS
```

Rules:
- Claude is reviewer-only.
- Do not let Claude edit files.
- Do not fix review findings in this skill unless the user explicitly asked for `$cr:review-fix`.
- Preserve user flags such as `--background`, `--base`, `--scope`, `--mode`, `--model`, and `--max-turns`.
