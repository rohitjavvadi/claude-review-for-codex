# Launch Notes

This file keeps the public positioning ready for posts, directories, and repo announcements.

## One-Liner

Claude Review for Codex gives Codex a read-only Claude Code reviewer and an opt-in disposable-worktree implementer, while Codex stays the final merge gate.

## Short Description

Claude Review for Codex is a local Codex plugin for multi-model code review. Claude can review bounded, redacted context, run adversarial checks, verify fixes, or draft isolated implementation attempts in disposable worktrees. Codex remains responsible for validating findings, running tests, accepting or rejecting diffs, and merging.

## Why Developers Should Care

Most multi-agent coding workflows fail at the trust boundary: too many agents can write to the same repo. This project keeps the useful part, a second model's review and implementation attempt, while preserving an explicit Codex-controlled acceptance gate.

## Suggested GitHub Description

Codex plugin for read-only Claude Code reviews and supervised disposable-worktree implementation.

## Suggested Topics

`codex`, `claude-code`, `code-review`, `ai-agents`, `developer-tools`, `codex-plugin`, `multi-agent`, `nodejs`, `security-tools`, `worktree`

## Launch Post Draft

I built Claude Review for Codex: a local Codex plugin that lets Codex ask Claude Code for read-only reviews and adversarial checks.

The safety model is the point:

- Claude reviews bounded, redacted context.
- Review workflows are read-only.
- Claude can write only through explicit `$cr:implement`.
- Implementation happens in a disposable git worktree.
- Codex inspects, tests, accepts or rejects, and remains the merge gate.

Useful if you want a second model for code review without giving another agent uncontrolled access to your checkout.

Repo: https://github.com/rohitjavvadi/claude-review-for-codex
