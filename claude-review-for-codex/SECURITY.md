# Security Policy

## Supported Version

This is an experimental v0.1 project. Security-relevant fixes should target the `main` branch.

## Reporting Issues

Please report security issues privately by emailing `rohit@javvadi.in`.

Do not open a public issue for vulnerabilities involving secret leakage, unsafe tool permissions, bypasses of the disposable-worktree boundary, or artifact exposure.

## Safety Model

- Review workflows invoke Claude with read-only tools.
- Write-capable Claude tools are allowed only for explicit `$cr:implement` runs.
- Implementation runs happen inside disposable git worktrees.
- Codex remains responsible for inspecting diffs, running tests, accepting or rejecting output, and merging.
- Runtime artifacts are written under `.codex/claude-reviews/` in the target repository.

If a change weakens any of these constraints, it should be treated as security-relevant.
