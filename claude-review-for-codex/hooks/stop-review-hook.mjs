#!/usr/bin/env node
import { loadConfig } from "../scripts/lib/config.mjs";
import { ensureGitRepository } from "../scripts/lib/git.mjs";

try {
  const repoRoot = ensureGitRepository(process.cwd());
  const config = loadConfig(repoRoot);
  if (!config.hooksEnabled || !config.allowAutoHooks) {
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    decision: "allow",
    reason: "Claude Review for Codex hooks are enabled, but automatic spending is not performed by the stop hook. Run $cr:review or $cr:review-fix explicitly.",
  }) + "\n");
} catch {
  process.exit(0);
}
