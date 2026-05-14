import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FAKE_REVIEW, FAKE_VERIFY, PLUGIN_ROOT, run, runCli, tempRepo } from "./helpers.mjs";

test("setup keeps hooks disabled by default", () => {
  const repo = tempRepo("crg-setup");
  const result = runCli(["setup", "--json"], repo);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.config.hooksEnabled, false);
  assert.equal(payload.hooks.enabled, false);
  assert.equal(payload.config.maxBudgetUsd, null);
});

test("stop hook is no-op by default", () => {
  const repo = tempRepo("crg-hook-default");
  const hook = run(process.execPath, [path.join(PLUGIN_ROOT, "hooks", "stop-review-hook.mjs")], repo);
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(hook.stdout, "");
});

test("command help works without requiring a value", () => {
  const repo = tempRepo("crg-help");
  const result = runCli(["review", "--help"], repo);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: claude-review-for-codex review/);
});

test("invalid scope and numeric flags fail clearly in JSON mode", () => {
  const repo = tempRepo("crg-bad-flags");
  fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
  const scope = runCli(["estimate", "--scope", "banana", "--json"], repo);
  assert.notEqual(scope.status, 0);
  assert.match(JSON.parse(scope.stdout).error.message, /Invalid --scope/);

  const maxTurns = runCli(["estimate", "--max-turns", "abc", "--json"], repo);
  assert.notEqual(maxTurns.status, 0);
  assert.match(JSON.parse(maxTurns.stdout).error.message, /--max-turns/);
});

test("review with fake Claude creates Markdown artifacts", () => {
  const repo = tempRepo("crg-review");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "console.log('hi')\n");
  const result = runCli(["review", "--mode", "cheap", "--json"], repo, {
    CR_FAKE_CLAUDE_RESULT: FAKE_REVIEW,
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.reviewMarkdown, /Needs attention/);
  assert.ok(fs.existsSync(path.join(payload.artifactDir, "context.json")));
  assert.ok(fs.existsSync(path.join(payload.artifactDir, "review.md")));
  assert.ok(fs.existsSync(path.join(payload.artifactDir, "raw-output.txt")));
  assert.ok(fs.existsSync(path.join(payload.artifactDir, "summary.json")));
});

test("review preserves arbitrary readable Claude output without schema validation", () => {
  const repo = tempRepo("crg-review-markdown");
  fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
  const raw = "Verdict: Needs attention\n\nFinding: the readable review should be preserved.";
  const result = runCli(["review", "--json"], repo, {
    CR_FAKE_CLAUDE_RESULT: raw,
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reviewMarkdown, raw);
  assert.equal(fs.readFileSync(path.join(payload.artifactDir, "raw-output.txt"), "utf8").trim(), raw);
});

test("verify with fake Claude writes verification artifact", () => {
  const repo = tempRepo("crg-verify");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "console.log('hi')\n");
  const review = runCli(["review", "--json"], repo, { CR_FAKE_CLAUDE_RESULT: FAKE_REVIEW });
  assert.equal(review.status, 0, review.stderr);
  const reviewPayload = JSON.parse(review.stdout);
  fs.writeFileSync(path.join(reviewPayload.artifactDir, "decisions.json"), JSON.stringify({
    review_id: reviewPayload.reviewId,
    decisions: [{
      finding_id: "CR-001",
      decision: "accepted",
      reason: "Confirmed locally.",
      files_changed_by_codex: ["src/app.js"],
      tests_run: []
    }]
  }, null, 2));
  const verify = runCli(["verify", "--review-id", reviewPayload.reviewId, "--json"], repo, {
    CR_FAKE_CLAUDE_RESULT: FAKE_VERIFY,
  });
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(JSON.parse(verify.stdout).verificationMarkdown, /verified/);
  assert.ok(fs.existsSync(path.join(reviewPayload.artifactDir, "verification.md")));
});

test("review-fix writes decisions template and keeps JSON output parseable", () => {
  const repo = tempRepo("crg-review-fix");
  fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
  const result = runCli(["review-fix", "--json"], repo, { CR_FAKE_CLAUDE_RESULT: FAKE_REVIEW });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.decisionsPath);
  assert.ok(fs.existsSync(payload.decisionsPath));
  assert.deepEqual(JSON.parse(fs.readFileSync(payload.decisionsPath, "utf8")).decisions, []);
});

test("review-fix honors explicit review id", () => {
  const repo = tempRepo("crg-review-fix-id");
  fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
  const result = runCli(["review-fix", "--review-id", "qa-current-review-fix", "--json"], repo, { CR_FAKE_CLAUDE_RESULT: FAKE_REVIEW });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reviewId, "qa-current-review-fix");
  assert.ok(payload.artifactDir.endsWith(path.join(".codex", "claude-reviews", "qa-current-review-fix")));
});

test("verify requires non-empty decisions", () => {
  const repo = tempRepo("crg-verify-decisions");
  fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
  const review = runCli(["review", "--json"], repo, { CR_FAKE_CLAUDE_RESULT: FAKE_REVIEW });
  assert.equal(review.status, 0, review.stderr);
  const reviewPayload = JSON.parse(review.stdout);

  const missing = runCli(["verify", "--review-id", reviewPayload.reviewId, "--json"], repo, {
    CR_FAKE_CLAUDE_RESULT: FAKE_VERIFY,
  });
  assert.notEqual(missing.status, 0);
  assert.match(JSON.parse(missing.stdout).error.message, /decisions\.json/);

  fs.writeFileSync(path.join(reviewPayload.artifactDir, "decisions.json"), JSON.stringify({
    review_id: reviewPayload.reviewId,
    decisions: []
  }, null, 2));
  const empty = runCli(["verify", "--review-id", reviewPayload.reviewId, "--json"], repo, {
    CR_FAKE_CLAUDE_RESULT: FAKE_VERIFY,
  });
  assert.notEqual(empty.status, 0);
  assert.match(JSON.parse(empty.stdout).error.message, /at least one/);
});

test("JSON-looking Claude output is still preserved as readable output", () => {
  const repo = tempRepo("crg-json-looking-output");
  fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
  const result = runCli(["review", "--json"], repo, { CR_FAKE_CLAUDE_RESULT: "{\"bad\": true}" });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reviewMarkdown, "{\"bad\": true}");
  assert.equal(JSON.parse(fs.readFileSync(path.join(payload.artifactDir, "summary.json"), "utf8")).status, "completed");
});

test("background review starts tracked job and completes with fake Claude", async () => {
  const repo = tempRepo("crg-bg");
  fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
  const start = runCli(["review", "--background", "--json"], repo, { CR_FAKE_CLAUDE_RESULT: FAKE_REVIEW });
  assert.equal(start.status, 0, start.stderr);
  const job = JSON.parse(start.stdout);
  assert.equal(job.status, "running");
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const status = runCli(["status", "--json"], repo);
    const payload = JSON.parse(status.stdout);
    const current = payload.jobs.find((item) => item.id === job.id);
    if (current?.status === "completed") {
      assert.ok(current.reviewId);
      assert.ok(current.stdoutLog);
      assert.ok(current.stderrLog);
      assert.ok(fs.existsSync(current.stdoutLog));
      assert.ok(fs.existsSync(current.stderrLog));
      return;
    }
  }
  assert.fail("background job did not complete");
});

test("status marks dead running jobs as failed", () => {
  const repo = tempRepo("crg-stale-job");
  const jobs = path.join(repo, ".codex", "claude-reviews", "jobs");
  fs.mkdirSync(jobs, { recursive: true });
  fs.writeFileSync(path.join(jobs, "stale.json"), JSON.stringify({
    id: "stale",
    status: "running",
    command: "review",
    args: [],
    cwd: repo,
    reviewId: "missing-review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    pid: 99999999,
    exitCode: null,
    error: null,
    stderrLog: path.join(jobs, "stale.stderr.log"),
    stdoutLog: path.join(jobs, "stale.stdout.log")
  }, null, 2));
  fs.writeFileSync(path.join(jobs, "stale.stderr.log"), "boom\n");
  const status = runCli(["status", "--json"], repo);
  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  const stale = payload.jobs.find((job) => job.id === "stale");
  assert.equal(stale.status, "failed");
  assert.match(stale.stderrTail, /boom/);
});

test("status keeps validation-failed background reviews failed", () => {
  const repo = tempRepo("crg-validation-failed-job");
  const root = path.join(repo, ".codex", "claude-reviews");
  const jobs = path.join(root, "jobs");
  const reviewId = "review-validation-failed";
  fs.mkdirSync(path.join(root, reviewId), { recursive: true });
  fs.mkdirSync(jobs, { recursive: true });
  fs.writeFileSync(path.join(root, reviewId, "summary.json"), JSON.stringify({
    reviewId,
    status: "validation_failed",
    error: "verdict must be one of: approve, needs-attention."
  }, null, 2));
  fs.writeFileSync(path.join(jobs, "validation-failed.json"), JSON.stringify({
    id: "validation-failed",
    status: "running",
    command: "review",
    args: [],
    cwd: repo,
    reviewId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    pid: 99999999,
    exitCode: null,
    error: null,
    stderrLog: path.join(jobs, "validation-failed.stderr.log"),
    stdoutLog: path.join(jobs, "validation-failed.stdout.log")
  }, null, 2));
  const status = runCli(["status", "--json"], repo);
  assert.equal(status.status, 0, status.stderr);
  const payload = JSON.parse(status.stdout);
  const job = payload.jobs.find((item) => item.id === "validation-failed");
  assert.equal(job.status, "failed");
  assert.match(job.error, /verdict/);
});

test("result returns job diagnostics when review artifacts are missing", () => {
  const repo = tempRepo("crg-result-missing-artifacts");
  const root = path.join(repo, ".codex", "claude-reviews");
  const jobs = path.join(root, "jobs");
  fs.mkdirSync(jobs, { recursive: true });
  fs.mkdirSync(path.join(root, "missing-review"), { recursive: true });
  const stdoutLog = path.join(jobs, "missing-artifacts.stdout.log");
  const stderrLog = path.join(jobs, "missing-artifacts.stderr.log");
  fs.writeFileSync(stdoutLog, "review started\n");
  fs.writeFileSync(stderrLog, "first line\nlast useful error\n");
  fs.writeFileSync(path.join(jobs, "missing-artifacts.json"), JSON.stringify({
    id: "missing-artifacts",
    status: "failed",
    command: "review",
    args: [],
    cwd: repo,
    reviewId: "missing-review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    pid: 99999999,
    exitCode: 1,
    error: "Background job process exited before producing review artifacts.",
    stderrLog,
    stdoutLog,
    stderrTail: null
  }, null, 2));

  const result = runCli(["result", "missing-artifacts", "--json"], repo);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.jobId, "missing-artifacts");
  assert.equal(payload.status, "failed");
  assert.equal(payload.error, "Background job process exited before producing review artifacts.");
  assert.equal(payload.reviewId, "missing-review");
  assert.equal(payload.stdoutLog, stdoutLog);
  assert.equal(payload.stderrLog, stderrLog);
  assert.match(payload.stderrTail, /last useful error/);
});

test("cancel marks a running background review as cancelled", () => {
  const repo = tempRepo("crg-cancel");
  fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
  const start = runCli(["review", "--background", "--json"], repo, {
    CR_FAKE_CLAUDE_RESULT: FAKE_REVIEW,
    CR_FAKE_CLAUDE_DELAY_MS: "5000",
  });
  assert.equal(start.status, 0, start.stderr);
  const job = JSON.parse(start.stdout);
  const cancel = runCli(["cancel", job.id, "--json"], repo);
  assert.equal(cancel.status, 0, cancel.stderr);
  assert.equal(JSON.parse(cancel.stdout).status, "cancelled");
});

test("cancel is idempotent for already cancelled jobs", () => {
  const repo = tempRepo("crg-cancel-idempotent");
  const jobs = path.join(repo, ".codex", "claude-reviews", "jobs");
  fs.mkdirSync(jobs, { recursive: true });
  const jobPath = path.join(jobs, "already-cancelled.json");
  const job = {
    id: "already-cancelled",
    status: "cancelled",
    command: "review",
    args: [],
    cwd: repo,
    reviewId: "review-cancelled",
    createdAt: "2026-05-14T00:00:00.000Z",
    updatedAt: "2026-05-14T00:00:01.000Z",
    startedAt: "2026-05-14T00:00:02.000Z",
    finishedAt: "2026-05-14T00:00:03.000Z",
    pid: 99999999,
    exitCode: null,
    error: "Cancelled by user.",
    stdoutLog: null,
    stderrLog: null,
    stderrTail: null,
    lastHeartbeat: null,
    audit: { cancelledBy: "test", attempts: 1 }
  };
  fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));
  const before = fs.readFileSync(jobPath, "utf8");

  const first = runCli(["cancel", "already-cancelled", "--json"], repo);
  const second = runCli(["cancel", "already-cancelled", "--json"], repo);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(JSON.parse(first.stdout), job);
  assert.deepEqual(JSON.parse(second.stdout), job);
  assert.equal(fs.readFileSync(jobPath, "utf8"), before);
});
