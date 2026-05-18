# Claude Review for Codex

Experimental v0.1 Codex plugin for asking Claude Code to review code without giving Claude write access.

Claude Review for Codex is a local Codex plugin that lets Codex ask Claude Code for a read-only code review while Codex remains the only agent allowed to edit files.

The plugin is intentionally simple:

- Codex collects a bounded, redacted review context.
- Claude Code reviews that context with read-only tools.
- Claude returns a human-readable Markdown review.
- Codex validates any findings before acting.
- Codex records decisions and applies fixes itself.

## Quick Install

1. Clone this repo:

```bash
git clone https://github.com/rohitjavvadi/claude-review-for-codex.git
cd claude-review-for-codex
```

2. Run the install doctor from the cloned repository root:

```bash
node scripts/doctor.mjs
```

3. Copy the printed **Codex local marketplace path**.

4. In the Codex app, open **Plugins**, add a **local marketplace**, paste that path, and install:

```text
claude-review-for-codex
```

5. Open any repo in Codex and run:

```text
$cr:setup
$cr:review
```

For now, Codex local plugin install still needs that one Plugins UI step. The doctor script checks the repo shape and prints the exact path to paste.

After the plugin is installed into Codex's local cache, the plugin's own `scripts/doctor.mjs` runs in diagnostics mode only. Use the root doctor above when adding or refreshing the local marketplace.

## Why This Exists

Codex is excellent at implementing fixes, but a second model can be useful for adversarial review, regression hunting, security checks, migration risk, and test-gap discovery. This plugin gives Codex a Claude reviewer without giving Claude write access.

## Release Status

This is an experimental v0.1 release. The core safety and orchestration paths are covered by tests with fake Claude output, but real Claude review quality depends on the model, prompt, repository context, and account limits. Treat Claude output as advisory evidence, not an automatic gate.

## Safety Contract

- Claude is advisory only.
- Claude must never edit, write, patch, stage, commit, install packages, or run arbitrary Bash.
- Codex is the only writer and fixer.
- Reviews are Markdown-first. The plugin does not reject Claude output because of schema formatting drift.
- Hooks are included but disabled by default.
- No automatic Claude spending happens on install.
- Review artifacts are saved under `.codex/claude-reviews/`.

## Target Repository Ignore Rule

The plugin writes runtime artifacts into the repository being reviewed under `.codex/claude-reviews/`. Add this to the target repository's `.gitignore` if it is not already ignored:

```gitignore
.codex/
```

If the target repo already uses `.codex/` for other checked-in config, ignore only the review artifacts:

```gitignore
.codex/claude-reviews/
```

You can also let setup add the narrower ignore entry explicitly:

```text
$cr:setup --add-gitignore
```

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

## How It Appears In Codex

After install, the plugin appears in Codex chats as:

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
node scripts/claude-review-for-codex.mjs review --model "opus 4.7"
node scripts/claude-review-for-codex.mjs review --codex-context-file .codex/claude-reviews/input/codex-context.md
node scripts/claude-review-for-codex.mjs review --background
node scripts/claude-review-for-codex.mjs status
node scripts/claude-review-for-codex.mjs status --current-plugin
node scripts/claude-review-for-codex.mjs result
```

## Review Modes

- `cheap`: Sonnet, diff-only, low turns.
- `standard`: Sonnet, diff plus bounded nearby context.
- `deep`: wider context, explicit opt-in.
- `adversarial`: security, rollback, data loss, migrations, race conditions, and high-cost failure paths.

## Claude Models

`--model` accepts Claude Code aliases such as `sonnet`, `opus`, `haiku`, and `opusplan`. It also accepts friendly Claude 4 family names such as `opus 4.7`, `Claude Opus 4.7`, or `claude-opus-4.7` and normalizes them to Claude Code's compact model form, such as `claude-opus-4-7`.

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

## Repository Instructions

The context collector automatically includes bounded, redacted repository instruction files when present:

- nearest `AGENTS.md` from the review working directory upward
- Markdown files referenced from that `AGENTS.md`, such as `CLAUDE.md`
- root Claude instruction files: `CLAUDE.md`, `claude.md`, `.claude/CLAUDE.md`, `.claude/claude.md`

These files are stored in `context.json` under `repo_instructions`. They are included even when unchanged, so Claude sees the repo's review rules without needing the whole repository.

## Codex Context Injection

The review skills now create a small Codex-authored context file before calling Claude, then pass it with:

```bash
--codex-context-file .codex/claude-reviews/input/codex-context.md
```

This is the bridge between Codex's live chat understanding and Claude's read-only review. It helps when the repository has no `CLAUDE.md`, no useful git history, or when the user asked for a review target that is clearer in the conversation than in the diff.

The file should stay concise:

```markdown
# Codex Context

User request: review the last three commits for sync regressions.
Review target: HEAD~3..HEAD.
Codex summary: changed matching logic and report generation.
Checks run: npm test passed.
Known concerns: stale artifacts should not be included in review context.
Claude focus: data loss, skipped records, rollback safety, missing tests.
```

The plugin redacts likely secrets from this file, injects the redacted text into the prompt, and saves the injected copy as `codex-context.md` in the review artifact directory.

## Artifacts

Created by `review` and `adversarial-review`:

```text
.codex/claude-reviews/<review-id>/
  codex-context.md              optional, when --codex-context-file is used
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
  verification-codex-context.md optional, when --codex-context-file is used
  verification.md
```

`context.json` is the redacted payload sent to Claude. `raw-output.txt` is Claude's exact review text. `review.md` is the readable review shown to Codex and the user. `summary.json` includes the plugin name and version for new artifacts so older renamed-plugin history can be identified. `decisions.json` records which findings Codex accepted, rejected, or deferred.

`status` groups current plugin reviews separately from legacy or unknown artifacts. Use `status --current-plugin` when old renamed-plugin history makes the list noisy.

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
