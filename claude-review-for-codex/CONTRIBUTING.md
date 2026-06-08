# Contributing

Thanks for taking a look at Claude Review for Codex.

This project is intentionally conservative: Codex owns the main checkout, Claude reviews bounded context, and Claude can write only in an explicit disposable worktree. Contributions should preserve that safety model.

## Good First Areas

- Improve redaction and context collection.
- Improve review, adversarial review, and verification prompts.
- Make artifacts easier to inspect and replay.
- Add tests for scope guards and failure handling.
- Improve install diagnostics for Codex local marketplaces.

## Local Checks

Run these before opening a pull request:

```bash
npm test
node scripts/doctor.mjs
```

The tests use fake Claude output and should not spend Claude credits.

## Pull Request Expectations

- Keep Claude read-only in review workflows.
- Keep `$cr:implement` isolated to disposable worktrees.
- Do not add automatic spending or auto-run hooks by default.
- Add focused tests for behavior changes.
- Document new commands, flags, artifacts, or safety tradeoffs in `README.md`.
