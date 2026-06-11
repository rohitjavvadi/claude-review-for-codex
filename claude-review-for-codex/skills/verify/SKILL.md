---
name: verify
description: "Ask Claude read-only to verify whether Codex fixed accepted findings from a prior Claude Review for Codex run. Use for $cr:verify."
---

# Claude Review for Codex Verify

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Before running the command, create or overwrite `.codex/claude-reviews/input/codex-context.md` in the target repository unless the user already passed `--codex-context-file`. Always generate fresh context for this run; do not reuse an older QA/review context file. Keep it concise and include what Codex fixed, tests/checks run after the fix, any findings intentionally rejected/deferred, and any remaining uncertainty.

Run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" verify --codex-context-file .codex/claude-reviews/input/codex-context.md $ARGUMENTS
```

Rules:
- Verification is read-only.
- Claude checks accepted findings against the current diff and decisions.
- Codex remains responsible for any follow-up fixes.
- Friendly model names are supported. If the user asks for "fable", "fable 5", "opus 4.8", or "haiku 4.5", pass that value with `--model`; the CLI normalizes it before invoking Claude Code.
- Preserve `--fallback-model`, `--effort`, `--workflow`, and `--ultracode` when the user explicitly asks for Fable fallback, higher effort, dynamic workflows, or ultracode. Use workflow/ultracode only on explicit request because it can spawn many agents and consume more tokens.
- If the user supplies `--codex-context-file`, use their file path instead of creating/passing the default one.
