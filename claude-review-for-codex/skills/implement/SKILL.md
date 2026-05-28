---
name: implement
description: "Let Claude Code implement inside a disposable git worktree while Codex supervises, reviews the diff, runs tests, then accepts or rejects and cleans up. Use for $cr:implement."
---

# Claude Review for Codex Implement

Resolve `<plugin-root>` as two directories above this `SKILL.md`.

Before running the command, create or overwrite `.codex/claude-reviews/input/codex-context.md` in the target repository unless the user already passed `--codex-context-file`. Always generate fresh context for this run; do not reuse an older QA/review context file. Keep it concise and include:

- User request and desired implementation outcome.
- Codex's current understanding of the repository and constraints.
- Files, commands, or tests likely relevant.
- Explicit safety boundaries, such as files Claude must not edit.
- Any acceptance criteria Codex should verify.

Run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" implement --codex-context-file .codex/claude-reviews/input/codex-context.md $ARGUMENTS
```

Then Codex must:

1. Open the artifact directory printed by the command.
2. Read `summary.json`, `claude.diff`, and `raw-output.txt`.
3. Inspect every changed file in the disposable worktree.
4. Reject immediately if Claude changed files outside the requested scope, touched package metadata unexpectedly, staged/committed work, or introduced unsafe behavior.
5. Run discoverable tests or targeted checks in the disposable worktree.
6. If accepted, run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" implement-accept <run-id> --tests-run "<checks and result>"
```

7. If rejected, run:

```bash
node "<plugin-root>/scripts/claude-review-for-codex.mjs" implement-reject <run-id> --reason "<why rejected>"
```

Rules:

- Claude writes only inside the disposable git worktree created by the CLI.
- Claude is allowed `Read`, `Glob`, `Grep`, `LS`, `Edit`, `Write`, and `MultiEdit`.
- Claude is denied `Bash`, `WebFetch`, `WebSearch`, and `NotebookEdit`.
- Claude must not stage, commit, push, create branches, delete the worktree, install packages, or run shell commands.
- Codex is the only reviewer, tester, accepter, merger, rejecter, and cleanup authority.
- Do not run `implement-accept` until Codex has inspected the diff and run appropriate checks.
- Always finish with either `implement-accept` or `implement-reject`; do not leave disposable worktrees around.
- Friendly model names are supported. If the user asks for "opus 4.7", pass `--model "opus 4.7"` or `--model opus 4.7`; the CLI normalizes it before invoking Claude Code.
- If the user supplies `--codex-context-file`, use their file path instead of creating/passing the default one.
