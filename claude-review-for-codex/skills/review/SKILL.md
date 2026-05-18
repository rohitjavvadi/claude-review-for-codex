---
name: review
description: "Run a read-only Claude Code review of the current git diff. Use for $cr:review, including --background."
---

# Claude Review for Codex Review

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Before running the command, create or overwrite `.codex/claude-reviews/input/codex-context.md` in the target repository unless the user already passed `--codex-context-file`. Always generate fresh context for this run; do not reuse an older QA/review context file. Keep it concise and include:

- User request and review focus.
- Codex's understanding of the change.
- Files or commits being reviewed.
- Tests/checks Codex already ran and their results.
- Known failures, uncertainty, or areas where Claude should be skeptical.

Run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" review --codex-context-file .codex/claude-reviews/input/codex-context.md $ARGUMENTS
```

Rules:
- Claude is reviewer-only.
- Do not let Claude edit files.
- Do not fix review findings in this skill unless the user explicitly asked for `$cr:review-fix`.
- Preserve user flags such as `--background`, `--base`, `--scope`, `--mode`, `--model`, `--max-turns`, and `--max-budget-usd`.
- Friendly model names are supported. If the user asks for "opus 4.7", pass `--model "opus 4.7"` or `--model opus 4.7`; the CLI normalizes it before invoking Claude Code.
- If the user supplies `--codex-context-file`, use their file path instead of creating/passing the default one.
