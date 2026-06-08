# Claude Review for Codex

[![Tests](https://img.shields.io/badge/tests-49%20passing-brightgreen)](#development)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Codex Plugin](https://img.shields.io/badge/Codex-plugin-black)](#quick-install)
[![Claude Code](https://img.shields.io/badge/Claude-Code-orange)](#safety-contract)

Give Codex a second opinion from Claude Code without giving up control of the repo.

Claude Review for Codex is a local Codex plugin that lets Codex ask Claude Code for read-only code reviews, adversarial reviews, verification passes, and opt-in implementation attempts inside disposable git worktrees. Claude can critique or draft isolated changes; Codex remains the writer, tester, reviewer, merger, and final gate.

Use it when you want:

- a second model to review a diff before you ship it
- adversarial checks for regressions, migrations, security, data loss, and rollback risk
- Claude-written experiments that cannot touch your main checkout unless Codex accepts them
- review artifacts you can inspect, replay, and audit instead of hidden chat-only output

Read the short walkthrough: [docs/DEMO.md](docs/DEMO.md).

## Why It Matters

This is an Experimental v0.1 release. The safety and orchestration paths are covered by tests with fake Claude output, but real review quality still depends on Claude Code, repository context, prompts, and account limits.

AI coding gets stronger when agents can challenge each other. The unsafe version is giving every agent write access to the same checkout. This plugin takes the safer route:

```text
Codex owns the repo
Claude reviews bounded context
Claude can only write in an explicit disposable worktree
Codex validates, tests, accepts or rejects, then records the decision
```

That makes it useful for serious projects where a second model is valuable, but automatic multi-agent editing is too risky.

## What It Does

- **Read-only Claude reviews** for normal `$cr:review`, `$cr:adversarial-review`, `$cr:review-fix`, and `$cr:verify` workflows.
- **Disposable-worktree implementation** through `$cr:implement`, where Claude can write only in an isolated worktree.
- **Codex merge gate** for every implementation attempt. Codex must inspect, test, and explicitly accept or reject the run.
- **Scope guards** with `--allow`, `--deny`, and risky-file checks before acceptance.
- **Redacted bounded context** so secrets and generated artifacts are not sent by default.
- **Persistent artifacts** under `.codex/claude-reviews/` for reviews, decisions, logs, diffs, and verification output.
- **Hooks included but disabled by default** so install never starts spending Claude credits automatically.

## Quick Install

Requirements:

- Node.js 20+
- Git
- Claude Code CLI for live reviews
- Codex app with local plugin marketplace support

Clone the local marketplace repo:

```bash
git clone https://github.com/rohitjavvadi/claude-review-for-codex.git
cd claude-review-for-codex
node scripts/doctor.mjs
```

The doctor prints the **Codex local marketplace path**. In the Codex app:

1. Open **Plugins**.
2. Add a **local marketplace**.
3. Paste the path printed by `node scripts/doctor.mjs`.
4. Install `claude-review-for-codex`.
5. Open any repo in Codex and run:

```text
$cr:setup
$cr:review
```

For now, Codex local plugin install still needs that one Plugins UI step. The doctor checks the repo shape and prints the exact path to paste.

## Common Workflows

Ask Claude to review the current diff:

```text
$cr:review
```

Run a deeper adversarial review:

```text
$cr:adversarial-review
```

Have Claude review, then let Codex decide which findings are real:

```text
$cr:review-fix
```

Ask Claude to implement in a disposable worktree while Codex supervises:

```text
$cr:implement --allow "src/**" --test-cmd "npm test" "add focused tests for the parser"
```

Preview the merge plan:

```bash
node scripts/claude-review-for-codex.mjs implement-accept <run-id> --dry-run
```

Accept only after Codex reviews the diff and tests pass:

```bash
node scripts/claude-review-for-codex.mjs implement-accept <run-id> --tests-run "npm test passed"
```

Reject and clean up:

```bash
node scripts/claude-review-for-codex.mjs implement-reject <run-id> --reason "changed files outside scope"
```

## Commands

Codex skills use the `$cr:*` shorthand:

```text
$cr:setup
$cr:estimate
$cr:review
$cr:adversarial-review
$cr:review-fix
$cr:implement
$cr:verify
$cr:status
$cr:result
$cr:cancel
```

The CLI can also be run directly from the plugin root:

```bash
node scripts/claude-review-for-codex.mjs setup
node scripts/claude-review-for-codex.mjs estimate --mode standard
node scripts/claude-review-for-codex.mjs review --mode standard
node scripts/claude-review-for-codex.mjs review --model opus
node scripts/claude-review-for-codex.mjs review --model "opus 4.8"
node scripts/claude-review-for-codex.mjs review --codex-context-file .codex/claude-reviews/input/codex-context.md
node scripts/claude-review-for-codex.mjs review --background
node scripts/claude-review-for-codex.mjs implement --allow "src/**" --test-cmd "npm test" "add focused tests for the parser"
node scripts/claude-review-for-codex.mjs implement-status <run-id>
node scripts/claude-review-for-codex.mjs implement-accept <run-id> --dry-run
node scripts/claude-review-for-codex.mjs implement-accept <run-id> --tests-run "npm test passed"
node scripts/claude-review-for-codex.mjs implement-reject <run-id> --reason "changed files outside scope"
node scripts/claude-review-for-codex.mjs status
node scripts/claude-review-for-codex.mjs status --current-plugin
node scripts/claude-review-for-codex.mjs result
```

## Review Modes

- `cheap`: Sonnet, diff-only, low turns.
- `standard`: Sonnet, diff plus bounded nearby context.
- `deep`: wider context, explicit opt-in.
- `adversarial`: security, rollback, data loss, migrations, race conditions, and high-cost failure paths.

## Safety Contract

- Claude is advisory only for review, adversarial-review, review-fix, and verify.
- Claude must never edit, write, patch, stage, commit, install packages, or run arbitrary Bash in review workflows.
- `$cr:implement` is explicit opt-in for Claude writes, and those writes are confined to a disposable git worktree.
- Codex is the only accepter, merger, committer in the original checkout, rejecter, and cleanup authority.
- Reviews are Markdown-first. The plugin does not reject Claude output because of schema formatting drift.
- Hooks are included but disabled by default.
- No automatic Claude spending happens on install.
- Review artifacts are saved under `.codex/claude-reviews/`.

Claude is invoked through `claude -p` with read-only tools for review:

```text
Read, Glob, Grep, LS
```

Write-capable and risky tools are explicitly disallowed:

```text
Edit, Write, MultiEdit, NotebookEdit, Bash, WebFetch, WebSearch
```

`$cr:implement` is the explicit exception. It creates a disposable git worktree and lets Claude use `Edit`, `Write`, and `MultiEdit` only inside that isolated worktree. Claude is still denied `Bash`, `WebFetch`, `WebSearch`, and `NotebookEdit`; streaming supervision is enabled by default; Codex remains the merge gate.

## Artifacts

Created by `review` and `adversarial-review`:

```text
.codex/claude-reviews/<review-id>/
  codex-context.md
  context.json
  prompt.md
  raw-output.txt
  review.md
  summary.json
```

Created by `review-fix`:

```text
.codex/claude-reviews/<review-id>/
  decisions.json
```

Created by `verify`:

```text
.codex/claude-reviews/<review-id>/
  raw-verification-output.txt
  verification-codex-context.md
  verification.md
```

Created by `implement`:

```text
.codex/claude-reviews/implement-runs/<run-id>/
  claude.diff
  codex-context.md
  decision.json
  diff-stat.txt
  events.ndjson
  live.log
  prompt.md
  raw-output.txt
  risk-summary.json
  stderr.log
  summary.json
  test-results.json
```

`context.json` is the redacted payload sent to Claude. `raw-output.txt` is Claude's exact review or implementation summary. `review.md` is the readable review shown to Codex and the user. `decisions.json` records which findings Codex accepted, rejected, or deferred. `decision.json` records whether a supervised implementation run was accepted or rejected.

`status` groups current plugin reviews separately from legacy or unknown artifacts. Use `status --current-plugin` when old renamed-plugin history makes the list noisy.

## Repository Instructions

The context collector automatically includes bounded, redacted repository instruction files when present:

- nearest `AGENTS.md` from the review working directory upward
- Markdown files referenced from that `AGENTS.md`, such as `CLAUDE.md`
- root Claude instruction files: `CLAUDE.md`, `claude.md`, `.claude/CLAUDE.md`, `.claude/claude.md`

These files are included even when unchanged, so Claude sees the repo's review rules without needing the whole repository.

## Codex Context Injection

The review skills create a small Codex-authored context file before calling Claude, then pass it with:

```bash
--codex-context-file .codex/claude-reviews/input/codex-context.md
```

This bridges Codex's live chat understanding into Claude's read-only review. It helps when the repository has no useful instruction file, no useful git history, or the user request is clearer in the conversation than in the diff.

Example:

```markdown
# Codex Context

User request: review the last three commits for sync regressions.
Review target: HEAD~3..HEAD.
Codex summary: changed matching logic and report generation.
Checks run: npm test passed.
Known concerns: stale artifacts should not be included in review context.
Claude focus: data loss, skipped records, rollback safety, missing tests.
```

## Target Repository Ignore Rule

The plugin writes runtime artifacts into the repository being reviewed under `.codex/claude-reviews/`. Add this to the target repository's `.gitignore` if it is not already ignored:

```gitignore
.codex/
```

If the target repo already uses `.codex/` for checked-in config, ignore only the review artifacts:

```gitignore
.codex/claude-reviews/
```

You can also let setup add the narrower ignore entry:

```text
$cr:setup --add-gitignore
```

## Privacy And Billing

Claude Review for Codex sends redacted diffs and bounded file context to Claude. It does not send the whole repository by default. Generated review artifacts, logs, temp files, and `node_modules` are excluded from review context.

Starting June 15, 2026, Anthropic says `claude -p`, Claude Agent SDK usage, Claude Code GitHub Actions, and third-party Agent SDK apps draw from a separate monthly Agent SDK credit for eligible Claude plans. Once that credit is exhausted, usage may require extra/API billing or stop until refresh, depending on account settings.

Because of that:

- Hooks are disabled by default.
- Deep and adversarial reviews require explicit user action.
- No default budget cap is applied.
- If you want a cap for a specific run, pass `--max-budget-usd <amount>`.

## Development

Run tests:

```bash
npm test
```

The test suite uses fake Claude output via `CR_FAKE_CLAUDE_RESULT`, so tests do not spend Claude credits.

## Repository Layout

```text
../.agents/plugins/marketplace.json    Local Codex marketplace registration
.codex-plugin/plugin.json              Codex plugin manifest
assets/                                Plugin icon/logo assets
hooks/                                 Optional hooks, disabled by default
schemas/decisions.schema.json          Decision artifact schema
scripts/                               Node CLI implementation
skills/                                Codex skills exposed as $cr:* workflows
tests/                                 Node test suite
```

## Contributing

Issues and pull requests are welcome. The highest-value areas are safer context collection, better review prompts, clearer artifacts, stronger scope guards, and smoother local marketplace installation.

Before opening a PR:

```bash
npm test
node scripts/doctor.mjs
```

## License

MIT
