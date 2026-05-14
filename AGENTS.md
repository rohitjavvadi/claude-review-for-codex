# Claude Review for Codex Marketplace

This repository contains a local Codex plugin marketplace for `claude-review-for-codex`.

## Project Layout

- `.agents/plugins/marketplace.json` registers the local marketplace.
- `claude-review-for-codex/` is the plugin root.
- `claude-review-for-codex/.codex-plugin/plugin.json` is the Codex plugin manifest.
- `claude-review-for-codex/skills/` contains Codex skills surfaced as `$cr:*` workflows.
- `claude-review-for-codex/scripts/` contains the Node CLI implementation.
- `claude-review-for-codex/hooks/` contains optional Codex hooks. Hooks must remain disabled by default.
- `claude-review-for-codex/schemas/` contains the decision schema. Reviews and verification reports are Markdown-first at runtime.
- `claude-review-for-codex/tests/` contains the Node test suite.

## Core Contract

Claude Review for Codex lets Codex ask Claude Code for read-only review.

- Claude is advisory only.
- Claude must never edit, write, patch, stage, commit, install packages, or run arbitrary Bash.
- Codex is the only writer/fixer.
- Codex must validate Claude findings before acting.
- Every review should be cost-aware, bounded, readable, and saved as an artifact.

## Development

Run tests from the plugin root:

```bash
cd claude-review-for-codex
npm test
```

The test suite uses fake Claude output through `CR_FAKE_CLAUDE_RESULT`, so tests should not spend Claude credits.

## Plugin Usage

Use the CLI directly from the marketplace root:

```bash
node claude-review-for-codex/scripts/claude-review-for-codex.mjs setup
node claude-review-for-codex/scripts/claude-review-for-codex.mjs review --mode cheap
node claude-review-for-codex/scripts/claude-review-for-codex.mjs review --background
node claude-review-for-codex/scripts/claude-review-for-codex.mjs status
```

The Codex marketplace source is this repository root.

## Safety Notes

- Do not enable hooks automatically.
- Do not remove budget controls such as `--max-budget-usd` or `--max-turns`.
- Do not add write-capable Claude tool access.
- Keep secret redaction applied to context, prompts, logs, and artifacts.
- Keep README billing notes current if Anthropic changes Agent SDK credit policy.
