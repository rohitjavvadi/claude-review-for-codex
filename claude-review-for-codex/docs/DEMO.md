# Demo Walkthrough

This walkthrough shows what Claude Review for Codex does after installation.

## 1. Ask For A Review

In a Codex chat opened inside a git repository:

```text
$cr:review
```

Codex collects a bounded review context, redacts likely secrets, and asks Claude Code to review it with read-only tools. Claude is allowed to inspect files through `Read`, `Glob`, `Grep`, and `LS`. It is not allowed to edit, write, run shell commands, fetch the web, stage files, or commit.

The review is written to:

```text
.codex/claude-reviews/<review-id>/review.md
```

You also get:

```text
.codex/claude-reviews/<review-id>/context.json
.codex/claude-reviews/<review-id>/prompt.md
.codex/claude-reviews/<review-id>/raw-output.txt
.codex/claude-reviews/<review-id>/summary.json
```

## 2. Have Codex Decide What Is Real

```text
$cr:review-fix
```

Claude findings are advisory. Codex must inspect them and record a decision:

```json
{
  "finding_id": "finding-1",
  "status": "accepted",
  "reason": "The failing edge case is reproducible and covered by the requested scope."
}
```

Accepted findings are fixed by Codex, not by Claude. Rejected and deferred findings are recorded with reasons.

## 3. Run An Adversarial Pass

```text
$cr:adversarial-review
```

Use this for changes where the failure cost is high:

- migrations
- authentication
- billing
- data deletion
- background jobs
- rollback behavior
- concurrency and race conditions

The goal is not style feedback. The goal is to find ways the change can fail in production.

## 4. Let Claude Draft In Isolation

```text
$cr:implement --allow "src/**" --test-cmd "npm test" "add parser tests for escaped quotes"
```

This is the only mode where Claude can write files. The CLI creates a disposable git worktree and lets Claude edit only there. The original checkout is not modified.

Implementation artifacts are written to:

```text
.codex/claude-reviews/implement-runs/<run-id>/
```

Important files:

```text
claude.diff
events.ndjson
live.log
risk-summary.json
test-results.json
decision.json
```

Codex can inspect the result:

```bash
node scripts/claude-review-for-codex.mjs implement-status <run-id>
```

Preview the merge plan:

```bash
node scripts/claude-review-for-codex.mjs implement-accept <run-id> --dry-run
```

Accept only after reviewing and testing:

```bash
node scripts/claude-review-for-codex.mjs implement-accept <run-id> --tests-run "npm test passed"
```

Reject if the diff is wrong, risky, or outside scope:

```bash
node scripts/claude-review-for-codex.mjs implement-reject <run-id> --reason "changed files outside requested scope"
```

## What Makes This Different

The core design is not "Claude writes code for Codex." The design is a trust boundary:

- Claude can review bounded context.
- Claude can draft changes only in a disposable worktree.
- Codex owns validation, tests, acceptance, rejection, merge, and cleanup.
- Every important decision leaves an artifact.

That gives you a second model without giving it uncontrolled write access to the main checkout.
