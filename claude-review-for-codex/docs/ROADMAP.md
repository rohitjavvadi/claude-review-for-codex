# Roadmap And Contribution Ideas

Claude Review for Codex is useful today, but the project gets more valuable as it becomes easier to install, easier to trust, and easier to audit.

## Near-Term Priorities

### 1. Better Install Experience

Current install uses a local Codex marketplace path printed by `node scripts/doctor.mjs`. That works, but contributors can help make the setup more obvious and harder to misuse.

Useful work:

- clearer diagnostics when the repo is cloned in the wrong shape
- screenshots or terminal recordings for local marketplace install
- better error messages when Claude Code is missing
- platform-specific notes for macOS, Linux, and Windows

### 2. Review Quality Fixtures

The test suite uses fake Claude output so tests do not spend credits. The next step is adding small fixture repositories that model real review targets.

Useful fixtures:

- auth/session regression
- migration rollback risk
- data deletion bug
- async race condition
- generated-artifact exclusion
- framework route mapping edge case

### 3. Artifact UX

The plugin already writes review, decision, verification, implementation, and live-stream artifacts. Contributors can make those easier to inspect.

Useful work:

- compact terminal summaries
- improved `status` grouping
- clearer risk summaries for implementation runs
- a stable JSON schema for implementation decisions
- links between `review.md`, `decisions.json`, and `verification.md`

### 4. Scope And Safety Guards

The core safety property is that Codex owns the main checkout and Claude writes only inside explicit disposable worktrees.

Useful work:

- stronger default deny rules for sensitive files
- clearer explanations when `implement-accept` refuses a risky diff
- tests for symlinks, nested worktrees, generated files, and lockfiles
- better summaries of files changed outside `--allow` globs

### 5. Prompt And Context Improvements

Claude should see enough context to review well, but not the whole repo by default.

Useful work:

- better context budgeting
- stronger redaction tests
- repository instruction handling for nested projects
- mode-specific prompts for security, migrations, tests, and rollback

## Non-Goals

These are intentionally out of scope unless the safety model changes clearly:

- auto-accepting Claude patches
- enabling hooks by default
- sending whole repositories by default
- letting Claude write in the original checkout
- hiding Claude output in non-auditable chat-only logs

## Good First Issues To Open

If you want to contribute, these are good issue titles:

- Improve install doctor output when Claude Code is missing
- Add fixture for migration rollback review
- Add test coverage for symlink paths in implementation scope guards
- Improve `implement-status` summary for blocked risky files
- Add screenshots or GIFs to the demo walkthrough

## Maintainer Notes

Before merging changes, preserve these invariants:

- Review workflows keep Claude read-only.
- `$cr:implement` is explicit opt-in.
- Claude writes only inside a disposable git worktree.
- Codex remains the acceptance and merge gate.
- Tests must not spend Claude credits by default.
