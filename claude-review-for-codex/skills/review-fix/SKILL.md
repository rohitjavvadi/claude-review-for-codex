---
name: review-fix
description: "Run Claude read-only review, then have Codex validate each finding, fix accepted findings itself, run tests, and record decisions. Use for $cr:review-fix."
---

# Claude Review for Codex Review-Fix

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Before running the command, create or overwrite `.codex/claude-reviews/input/codex-context.md` in the target repository unless the user already passed `--codex-context-file`. Always generate fresh context for this run; do not reuse an older QA/review context file. Keep it concise and include:

- User request and desired fix/review outcome.
- Codex's current understanding of the diff.
- Files or commits being reviewed.
- Tests/checks already run.
- Known failures or risks Claude should inspect.

First run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" review-fix --codex-context-file .codex/claude-reviews/input/codex-context.md $ARGUMENTS
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

Friendly model names are supported. If the user asks for "opus 4.7", pass `--model "opus 4.7"` or `--model opus 4.7`; the CLI normalizes it before invoking Claude Code.

If the user supplies `--codex-context-file`, use their file path instead of creating/passing the default one.
