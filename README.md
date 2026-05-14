# Claude Review for Codex

Claude Review for Codex is a local Codex plugin that lets Codex ask Claude Code for a read-only code review while Codex remains the only agent allowed to edit files.

The plugin is intentionally simple:

- Codex collects a bounded, redacted review context.
- Claude Code reviews that context with read-only tools.
- Claude returns a human-readable Markdown review.
- Codex validates any findings before acting.
- Codex records decisions and applies fixes itself.

## Why This Exists

Codex is excellent at implementing fixes, but a second model can be useful for adversarial review, regression hunting, security checks, migration risk, and test-gap discovery. This plugin gives Codex a Claude reviewer without giving Claude write access.

## Safety Contract

- Claude is advisory only.
- Claude must never edit, write, patch, stage, commit, install packages, or run arbitrary Bash.
- Codex is the only writer and fixer.
- Reviews are Markdown-first. The plugin does not reject Claude output because of schema formatting drift.
- Hooks are included but disabled by default.
- No automatic Claude spending happens on install.
- Review artifacts are saved under `.codex/claude-reviews/`.

## Repository Layout

```text
.agents/plugins/marketplace.json       Local Codex marketplace registration
claude-review-for-codex/               Plugin root
  .codex-plugin/plugin.json            Codex plugin manifest
  assets/                              Plugin icon/logo assets
  hooks/                               Optional hooks, disabled by default
  schemas/decisions.schema.json        Decision artifact schema
  scripts/                             Node CLI implementation
  skills/                              Codex skills exposed as $cr:* workflows
  tests/                               Node test suite
```

## Install Locally In Codex

This repo is set up as a local Codex marketplace. From the repository root, the marketplace entry points at `./claude-review-for-codex`.

After adding the local marketplace in Codex, install:

```text
claude-review-for-codex
```

In Codex chats, the plugin appears as:

```text
[@claude-review-for-codex](plugin://claude-review-for-codex@local-claude-review-for-codex)
```

The `local-...` part is only the local marketplace source name. It is not the public project name.

## Commands

Codex skills use the `$cr:*` shorthand:

```text
$cr:setup
$cr:estimate
$cr:review
$cr:adversarial-review
$cr:review-fix
$cr:verify
$cr:status
$cr:result
$cr:cancel
```

You can also run the CLI directly from the plugin root:

```bash
node scripts/claude-review-for-codex.mjs setup
node scripts/claude-review-for-codex.mjs estimate --mode standard
node scripts/claude-review-for-codex.mjs review --mode standard
node scripts/claude-review-for-codex.mjs review --model opus
node scripts/claude-review-for-codex.mjs review --background
node scripts/claude-review-for-codex.mjs status
node scripts/claude-review-for-codex.mjs result
```

## Review Modes

- `cheap`: Sonnet, diff-only, low turns.
- `standard`: Sonnet, diff plus bounded nearby context.
- `deep`: wider context, explicit opt-in.
- `adversarial`: security, rollback, data loss, migrations, race conditions, and high-cost failure paths.

## Claude Permissions

Claude is invoked through `claude -p` with:

```text
Read, Glob, Grep, LS
```

Write-capable and risky tools are explicitly disallowed:

```text
Edit, Write, MultiEdit, NotebookEdit, Bash, WebFetch, WebSearch
```

The runner also uses `--permission-mode dontAsk`, `--no-session-persistence`, and `--disallowedTools` when supported by the installed Claude CLI.

## Artifacts

Each review writes durable artifacts:

```text
.codex/claude-reviews/<review-id>/
  context.json
  prompt.md
  raw-output.txt
  review.md
  summary.json
  decisions.json
  verification.md
  raw-verification-output.txt
```

`context.json` is the redacted payload sent to Claude. `raw-output.txt` is Claude's exact review text. `review.md` is the readable review shown to Codex and the user. `decisions.json` records which findings Codex accepted, rejected, or deferred.

## Review-Fix Workflow

`$cr:review-fix` runs a Claude review and creates a `decisions.json` template. Codex must then:

1. Inspect each Claude finding.
2. Accept, reject, or defer it with a reason.
3. Apply accepted fixes itself.
4. Run targeted tests.
5. Update `decisions.json`.
6. Optionally run `$cr:verify`.

Claude suggestions are advisory, not patches.

## Privacy And Billing

Claude Review for Codex sends redacted diffs and bounded file context to Claude. It does not send the whole repository by default. Generated review artifacts, logs, temp files, and `node_modules` are excluded from review context.

Starting June 15, 2026, Anthropic says `claude -p`, Claude Agent SDK usage, Claude Code GitHub Actions, and third-party Agent SDK apps draw from a separate monthly Agent SDK credit for eligible Claude plans. Once that credit is exhausted, usage may require extra/API billing or stop until refresh, depending on account settings.

Because of that:

- Hooks are disabled by default.
- Deep and adversarial reviews require explicit user action.
- No default budget cap is applied.
- If you want a cap for a specific run, pass `--max-budget-usd <amount>`.

## Development

Requirements:

- Node.js 20+
- Git
- Claude Code CLI for live reviews

Run tests:

```bash
cd claude-review-for-codex
npm test
```

The test suite uses fake Claude output via `CR_FAKE_CLAUDE_RESULT`, so tests do not spend Claude credits.

## License

MIT
