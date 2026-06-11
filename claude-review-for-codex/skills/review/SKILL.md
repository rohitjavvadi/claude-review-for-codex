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
- Preserve user flags such as `--background`, `--base`, `--scope`, `--mode`, `--model`, `--fallback-model`, `--effort`, `--workflow`, `--ultracode`, `--max-turns`, and `--max-budget-usd`.
- Friendly model names are supported. If the user asks for "fable", "fable 5", "opus 4.8", or "haiku 4.5", pass that value with `--model`; the CLI normalizes it before invoking Claude Code.
- If the user asks to use Fable safely, prefer `--model "fable 5" --fallback-model "opus 4.8"` unless they specify a different fallback.
- If the user asks for "workflow", "dynamic workflow", "ultracode", a large codebase-scale audit, or many independent subagent passes, pass `--workflow` or `--ultracode` exactly as requested. Use this only when explicitly requested because workflows can spawn many agents and consume more tokens.
- If the user supplies `--codex-context-file`, use their file path instead of creating/passing the default one.
