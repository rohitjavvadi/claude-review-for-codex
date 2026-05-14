#!/usr/bin/env node
import { ensureGitRepository } from "../scripts/lib/git.mjs";
import { listJobs } from "../scripts/lib/jobs.mjs";
import { loadConfig } from "../scripts/lib/config.mjs";

try {
  const repoRoot = ensureGitRepository(process.cwd());
  const config = loadConfig(repoRoot);
  if (!config.hooksEnabled) process.exit(0);
  const completed = listJobs(repoRoot).filter((job) => job.status === "completed").slice(0, 3);
  if (completed.length) {
    process.stdout.write(`Claude Review for Codex has completed background reviews. Use $cr:status or $cr:result ${completed[0].id}.\n`);
  }
} catch {
  process.exit(0);
}
