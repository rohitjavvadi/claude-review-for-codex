---
name: implement
description: "Let Claude Code implement inside a disposable git worktree while Codex live-supervises, reviews the diff, runs tests, then accepts or rejects and cleans up. Use for $cr:implement."
---

# Claude Review for Codex Implement

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Before running the command, create or overwrite `.codex/claude-reviews/input/codex-context.md` in the target repository unless the user already passed `--codex-context-file`. Always generate fresh context for this run; do not reuse an older QA/review context file. Keep it concise and include:

- User request and desired implementation outcome.
- Codex's current understanding of the repository and constraints.
- Files, commands, or tests likely relevant.
- Explicit safety boundaries, such as files Claude must not edit.
- Any acceptance criteria Codex should verify.

Run. Streaming is the default; pass `--stream` explicitly when the user says "watch while Claude does it", "live supervise", "monitor Claude", or similar:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" implement --stream --codex-context-file .codex/claude-reviews/input/codex-context.md $ARGUMENTS
```

When useful, add:

- `--allow "<glob>"` for expected edit scope.
- `--deny "<glob>"` for files Claude must not touch.
- `--test-cmd "<command>"` for checks Codex should run after Claude exits.
- `--timeout-ms <n>` for a hard runtime guard.
- `--allow-risky` only when the user explicitly expects risky paths such as package metadata, migrations, or CI workflows.
- `--model "fable 5" --fallback-model "opus 4.8"` when the user asks for Fable with an Opus fallback.
- `--effort xhigh`, `--workflow`, or `--ultracode` only when the user explicitly asks for higher effort, a dynamic workflow, ultracode, or a codebase-scale implementation/audit. Workflow subagents inherit the same worktree, tool, and path-scope limits but can use many more tokens.

Then Codex must:

1. Open the artifact directory printed by the command.
2. While the command runs, watch streamed output and/or run `implement-status <run-id>` if a run id is available.
3. Read `summary.json`, `risk-summary.json`, `events.ndjson`, `live.log`, `claude.diff`, and `raw-output.txt`.
4. Inspect every changed file in the disposable worktree.
5. Reject immediately if Claude changed files outside the requested scope, touched package metadata unexpectedly, staged/committed work, or introduced unsafe behavior.
6. Run discoverable tests or targeted checks in the disposable worktree, unless `--test-cmd` already ran the right checks.
7. If accepted, run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" implement-accept <run-id> --tests-run "<checks and result>"
```

Use `implement-accept <run-id> --dry-run` first if the merge/cleanup plan is unclear.

8. If rejected, run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" implement-reject <run-id> --reason "<why rejected>"
```

Rules:

- Claude writes only inside the disposable git worktree created by the CLI.
- Streaming supervision is the default for implementation runs.
- Claude is allowed `Read`, `Glob`, `Grep`, `LS`, `Edit`, `Write`, and `MultiEdit`.
- Claude is denied `Bash`, `WebFetch`, `WebSearch`, and `NotebookEdit`.
- Claude must not stage, commit, push, create branches, delete the worktree, install packages, or run shell commands.
- Codex is the only reviewer, tester, accepter, merger, rejecter, and cleanup authority.
- Do not run `implement-accept` until Codex has inspected the diff and run appropriate checks.
- Respect `status: blocked`, `status: tests-failed`, and `risk-summary.json`; those runs should be rejected or rerun with explicit scope.
- Always finish with either `implement-accept` or `implement-reject`; do not leave disposable worktrees around.
- Friendly model names are supported. If the user asks for "fable", "fable 5", "opus 4.8", or "haiku 4.5", pass that value with `--model`; the CLI normalizes it before invoking Claude Code.
- If the user supplies `--codex-context-file`, use their file path instead of creating/passing the default one.
