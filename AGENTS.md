# Repository Instructions

This repository contains the local marketplace wrapper and plugin source for `claude-review-for-codex`.

- Keep runtime artifacts out of git. `.codex/claude-reviews/`, `node_modules/`, logs, and temp files are ignored.
- Before pushing or releasing, run `npm test` from `claude-review-for-codex/` and `node scripts/doctor.mjs` from the repository root.
- For plugin releases, update `claude-review-for-codex/package.json`, `.codex-plugin/plugin.json`, the CLI `PLUGIN_VERSION`, README files, tests, and the local Codex plugin cache if the user asks to install it locally.
- `$cr:implement` should default to live supervised execution. If the user says to use the Claude Review for Codex plugin to implement, watch, supervise, or have Claude do a task, use the implement workflow with streaming, scope/risk checks, status artifacts, tests, and explicit accept/reject cleanup.
- Do not let Claude implementation runs merge automatically. Codex must inspect the diff, run appropriate checks, then run `implement-accept` or `implement-reject`.
