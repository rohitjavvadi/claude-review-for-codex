---
name: setup
description: "Configure Claude Review for Codex. Use for $cr:setup, checking Claude CLI/auth, auth mode, and optional hooks."
---

# Claude Review for Codex Setup

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" setup $ARGUMENTS
```

Rules:
- Hooks are disabled by default.
- Only enable hooks when the user explicitly asks for `--enable-hooks`.
- Explain that `claude -p` / Agent SDK usage may consume Anthropic Agent SDK credits after June 15, 2026.
