import fs from "node:fs";
import path from "node:path";
import { artifactRoot, createReviewId, readJson, safeId, writeJson } from "./artifacts.mjs";
import { spawnDetached } from "./process.mjs";

export function jobsDir(repoRoot) {
  return path.join(artifactRoot(repoRoot), "jobs");
}

export function jobFile(repoRoot, jobId) {
  return path.join(jobsDir(repoRoot), `${safeId(jobId)}.json`);
}

export function createJob(repoRoot, payload) {
  const id = payload.id ?? createReviewId("job");
  const now = new Date().toISOString();
  const job = {
    id,
    status: "queued",
    command: payload.command,
    args: payload.args ?? [],
    cwd: payload.cwd ?? repoRoot,
    reviewId: payload.reviewId ?? null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    pid: null,
    exitCode: null,
    error: null,
    stdoutLog: payload.stdoutLog ?? null,
    stderrLog: payload.stderrLog ?? null,
    stderrTail: null,
    lastHeartbeat: null,
  };
  fs.mkdirSync(jobsDir(repoRoot), { recursive: true });
  writeJson(jobFile(repoRoot, id), job);
  return job;
}

export function readJob(repoRoot, jobId) {
  const file = jobFile(repoRoot, jobId);
  if (!fs.existsSync(file)) return null;
  return readJson(file);
}

export function patchJob(repoRoot, jobId, updates) {
  const existing = readJob(repoRoot, jobId);
  if (!existing) {
    throw new Error(`Unknown job ${jobId}.`);
  }
  const next = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  writeJson(jobFile(repoRoot, jobId), next);
  return next;
}

export function listJobs(repoRoot) {
  const dir = jobsDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return readJson(path.join(dir, name));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((job) => reconcileJob(repoRoot, job))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function startBackgroundJob(repoRoot, scriptPath, commandArgs) {
  const reviewId = createReviewId("review");
  let job = createJob(repoRoot, {
    command: "review",
    args: commandArgs,
    reviewId,
    cwd: repoRoot,
  });
  const stdoutLog = path.join(jobsDir(repoRoot), `${safeId(job.id)}.stdout.log`);
  const stderrLog = path.join(jobsDir(repoRoot), `${safeId(job.id)}.stderr.log`);
  job = patchJob(repoRoot, job.id, { stdoutLog, stderrLog });
  const pid = spawnDetached(process.execPath, [
    scriptPath,
    "internal-run-job",
    "--job-id",
    job.id,
    "--review-id",
    reviewId,
    ...commandArgs,
  ], { cwd: repoRoot, stdoutFile: stdoutLog, stderrFile: stderrLog });
  if (!pid) {
    return patchJob(repoRoot, job.id, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "Failed to spawn background job.",
      stderrTail: readTail(stderrLog),
    });
  }
  return patchJob(repoRoot, job.id, { status: "running", pid, startedAt: new Date().toISOString(), lastHeartbeat: new Date().toISOString() });
}

export function cancelJob(repoRoot, jobId) {
  const job = readJob(repoRoot, jobId);
  if (!job) throw new Error(`Unknown job ${jobId}.`);
  if (job.status === "cancelled") {
    return job;
  }
  if (!job.pid || !["queued", "running"].includes(job.status)) {
    return patchJob(repoRoot, jobId, { status: job.status, error: "Job is not running." });
  }
  try {
    process.kill(job.pid, "SIGTERM");
    if (!waitForProcessExit(job.pid, 1500)) {
      try {
        process.kill(job.pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    if (waitForProcessExit(job.pid, 1500)) {
      return patchJob(repoRoot, jobId, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        error: "Cancelled by user.",
      });
    }
    return patchJob(repoRoot, jobId, {
      status: "cancel-requested",
      error: "Cancellation requested, but the process is still running.",
    });
  } catch (error) {
    if (error?.code === "ESRCH") {
      return patchJob(repoRoot, jobId, {
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        error: "Process had already exited.",
      });
    }
    return patchJob(repoRoot, jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: error.message,
    });
  }
}

export function reconcileJob(repoRoot, job) {
  if (!job || !["queued", "running", "cancel-requested"].includes(job.status)) {
    return job;
  }
  if (job.status === "queued" && !job.pid) {
    return job;
  }
  if (job.pid && processExists(job.pid)) {
    return job;
  }
  const summaryPath = job.reviewId
    ? path.join(artifactRoot(repoRoot), safeId(job.reviewId), "summary.json")
    : null;
  if (summaryPath && fs.existsSync(summaryPath)) {
    const summary = safeReadJson(summaryPath);
    if (summary?.status === "validation_failed") {
      return patchJob(repoRoot, job.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        exitCode: job.exitCode ?? 1,
        error: job.error ?? summary.error ?? "Claude review output failed validation.",
        stderrTail: readTail(job.stderrLog),
      });
    }
    return patchJob(repoRoot, job.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      exitCode: 0,
      stderrTail: readTail(job.stderrLog),
    });
  }
  return patchJob(repoRoot, job.id, {
    status: "failed",
    finishedAt: new Date().toISOString(),
    exitCode: job.exitCode ?? null,
    error: job.error ?? "Background job process exited before producing review artifacts.",
    stderrTail: readTail(job.stderrLog),
  });
}

export function jobResultInfo(repoRoot, jobId) {
  const job = readJob(repoRoot, jobId);
  if (!job) return null;
  const current = reconcileJob(repoRoot, job);
  return {
    jobId: current.id,
    status: current.status,
    error: current.error ?? null,
    reviewId: current.reviewId ?? null,
    stdoutLog: current.stdoutLog ?? null,
    stderrLog: current.stderrLog ?? null,
    stderrTail: current.stderrTail ?? readTail(current.stderrLog),
  };
}

function safeReadJson(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) {
      return true;
    }
    sleep(100);
  }
  return !processExists(pid);
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readTail(file, maxBytes = 8192) {
  if (!file || !fs.existsSync(file)) return "";
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
