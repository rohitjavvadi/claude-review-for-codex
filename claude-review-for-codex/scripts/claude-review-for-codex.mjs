#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, resolveMode, saveConfig } from "./lib/config.mjs";
import { collectReviewContext, ensureGitRepository, estimateContext } from "./lib/git.mjs";
import { getClaudeStatus, normalizeClaudeModel, runClaudeText } from "./lib/claude.mjs";
import { buildReviewPrompt, buildVerificationPrompt } from "./lib/prompts.mjs";
import { validateDecisions } from "./lib/schema.mjs";
import { artifactRoot, createReviewId, latestReview, listReviews, readJson, reviewDir, safeId, writeJson, writeReviewArtifacts } from "./lib/artifacts.mjs";
import { cancelJob, jobResultInfo, listJobs, patchJob, readJob, startBackgroundJob } from "./lib/jobs.mjs";
import { runCommand, runCommandChecked } from "./lib/process.mjs";
import { renderReview, renderStatus } from "./lib/render.mjs";
import { redactText } from "./lib/redaction.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_CODEX_CONTEXT_BYTES = 128 * 1024;
const PLUGIN_NAME = "claude-review-for-codex";
const PLUGIN_VERSION = "0.1.3";

async function main() {
  const [command = "help", ...argv] = process.argv.slice(2);
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      console.log(commandUsage(command));
      return;
    }
    switch (command) {
      case "setup":
        return await setup(argv);
      case "estimate":
        return await estimate(argv);
      case "review":
        return await review(argv, { reviewKind: "review" });
      case "adversarial-review":
        return await review(argv, { reviewKind: "adversarial" });
      case "review-fix":
        return await reviewFix(argv);
      case "implement":
        return await implement(argv);
      case "implement-accept":
        return await implementAccept(argv);
      case "implement-reject":
        return await implementReject(argv);
      case "verify":
        return await verify(argv);
      case "status":
        return await status(argv);
      case "result":
        return await result(argv);
      case "cancel":
        return await cancel(argv);
      case "internal-run-job":
        return await internalRunJob(argv);
      case "help":
      case "--help":
      case "-h":
        console.log(usage());
        return;
      default:
        throw new Error(`Unknown command "${command}".\n\n${usage()}`);
    }
  } catch (error) {
    if (wantsJson(argv)) {
      outputError({ command, message: error.message });
    } else {
      console.error(error.message);
    }
    process.exitCode = 1;
  }
}

function usage() {
  return [
    "Usage:",
    ...Object.values(COMMAND_USAGE).map((line) => `  ${line.replace(/^Usage: /, "")}`),
    "",
    "Run `claude-review-for-codex <command> --help` for command-specific help.",
  ].join("\n");
}

const COMMAND_USAGE = {
  setup: "Usage: claude-review-for-codex setup [--enable-hooks|--disable-hooks] [--add-gitignore] [--auth-mode subscription-cli|api-key] [--max-budget-usd <amount>|--clear-budget] [--json]",
  estimate: "Usage: claude-review-for-codex estimate [--mode cheap|standard|deep|adversarial] [--base <ref>] [--scope working-tree|branch] [--max-turns <n>] [--max-budget-usd <amount>] [--json]",
  review: "Usage: claude-review-for-codex review [--background] [--mode cheap|standard|deep] [--base <ref>] [--scope working-tree|branch] [--codex-context-file <path>] [--model <model>] [--max-turns <n>] [--max-budget-usd <amount>] [--json]",
  "adversarial-review": "Usage: claude-review-for-codex adversarial-review [--background] [--base <ref>] [--scope working-tree|branch] [--codex-context-file <path>] [--model <model>] [--max-turns <n>] [--max-budget-usd <amount>] [--json] [focus text]",
  "review-fix": "Usage: claude-review-for-codex review-fix [--review-id <id>] [--codex-context-file <path>] [review args...] [--json]",
  implement: "Usage: claude-review-for-codex implement [--codex-context-file <path>] [--worktree-dir <path>] [--branch <name>] [--model <model>] [--max-turns <n>] [--max-budget-usd <amount>] [--json] <task>",
  "implement-accept": "Usage: claude-review-for-codex implement-accept <run-id> [--message <commit message>] [--tests-run <summary>] [--review-note <note>] [--keep-worktree] [--json]",
  "implement-reject": "Usage: claude-review-for-codex implement-reject <run-id> [--reason <reason>] [--json]",
  verify: "Usage: claude-review-for-codex verify [review-id] [--review-id <id>] [--mode cheap|standard|deep] [--codex-context-file <path>] [--model <model>] [--max-turns <n>] [--max-budget-usd <amount>] [--json]",
  status: "Usage: claude-review-for-codex status [--current-plugin] [--limit <n>] [--json]",
  result: "Usage: claude-review-for-codex result [review-id|job-id] [--json]",
  cancel: "Usage: claude-review-for-codex cancel <job-id> [--json]",
};

function commandUsage(command) {
  return COMMAND_USAGE[command] ?? usage();
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["json", "background", "enable-hooks", "disable-hooks", "clear-budget", "add-gitignore", "current-plugin", "keep-worktree", "help", "h"].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[++i];
    if (value == null) throw new Error(`Missing value for --${key}.`);
    if (key === "model" && isModelVersionSuffix(argv[i + 1])) {
      options[key] = `${value} ${argv[++i]}`;
    } else {
      options[key] = value;
    }
  }
  return options;
}

function isModelVersionSuffix(value) {
  return typeof value === "string" && !value.startsWith("--") && /^\d+(?:[._-]\d+){0,2}(?:\[1m\])?$/.test(value);
}

function repoRootFromCwd() {
  return ensureGitRepository(process.cwd());
}

async function setup(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const updates = {};
  if (options["enable-hooks"]) {
    updates.hooksEnabled = true;
    updates.allowAutoHooks = true;
  }
  if (options["disable-hooks"]) {
    updates.hooksEnabled = false;
    updates.allowAutoHooks = false;
  }
  if (options["auth-mode"]) updates.authMode = options["auth-mode"];
  if (options["max-budget-usd"]) updates.maxBudgetUsd = optionalNumber(options["max-budget-usd"], "--max-budget-usd");
  if (options["clear-budget"]) updates.maxBudgetUsd = null;
  const config = saveConfig(repoRoot, updates);
  const gitignore = options["add-gitignore"] ? addGitignoreEntry(repoRoot) : null;
  const claude = getClaudeStatus(repoRoot);
  const payload = {
    repoRoot,
    config,
    gitignore,
    claude,
    hooks: {
      enabled: config.hooksEnabled === true,
      note: config.hooksEnabled
        ? "Hooks are enabled. Claude calls use explicit user-provided limits only."
        : "Hooks are disabled by default. Use setup --enable-hooks to opt in.",
    },
    capability_notice: claude.capabilities?.missingRequired?.length
      ? `Missing required Claude CLI flags: ${claude.capabilities.missingRequired.join(", ")}`
      : claude.capabilities?.missingOptional?.length
        ? `Missing optional Claude CLI flags: ${claude.capabilities.missingOptional.join(", ")}`
        : "Claude CLI exposes all checked review flags.",
    billing_notice: "Starting June 15, 2026, claude -p / Agent SDK usage may draw from Anthropic's separate monthly Agent SDK credit for eligible plans.",
  };
  output(payload, options.json, renderSetup(payload));
}

function renderSetup(payload) {
  return [
    "Claude Review for Codex setup",
    `Repo: ${payload.repoRoot}`,
    `Claude: ${payload.claude.available ? "available" : "missing"}; ${payload.claude.authenticated ? "authenticated" : "not authenticated"}`,
    `Auth mode: ${payload.config.authMode}`,
    `Default mode: ${payload.config.defaultMode}`,
    `Budget cap: ${payload.config.maxBudgetUsd == null ? "none by default" : `$${payload.config.maxBudgetUsd}`}`,
    `Hooks: ${payload.hooks.enabled ? "enabled" : "disabled"}`,
    payload.gitignore ? `Git ignore: ${payload.gitignore.message}` : "Git ignore: unchanged. Use setup --add-gitignore to ignore review artifacts.",
    payload.capability_notice,
    payload.billing_notice,
    "",
  ].join("\n");
}

async function estimate(argv) {
  const options = parseArgs(argv);
  validateScope(options.scope);
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const mode = resolveMode(options.mode, config);
  const context = collectReviewContext({
    cwd: repoRoot,
    base: options.base,
    scope: options.scope,
    includeNearbyContext: mode.includeNearbyContext,
    userIntent: options._.join(" "),
    config,
  });
  const estimatePayload = {
    mode: mode.name,
    target: context.target,
    changed_files: context.changed_files,
    redactions: context.redactions,
    ...estimateContext(context),
    maxBudgetUsd: optionalNumber(options["max-budget-usd"] ?? config.maxBudgetUsd ?? null, "--max-budget-usd"),
    maxTurns: optionalPositiveInteger(options["max-turns"] ?? mode.maxTurns ?? config.maxTurns, "--max-turns"),
  };
  output(estimatePayload, options.json, `${JSON.stringify(estimatePayload, null, 2)}\n`);
}

async function review(argv, { reviewKind }) {
  const options = parseArgs(argv);
  validateScope(options.scope);
  if (options["max-turns"] != null) optionalPositiveInteger(options["max-turns"], "--max-turns");
  if (options["max-budget-usd"] != null) optionalNumber(options["max-budget-usd"], "--max-budget-usd");
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const defaultMode = reviewKind === "adversarial" ? "adversarial" : undefined;
  const mode = resolveMode(options.mode ?? defaultMode, config);
  if (options.background) {
    const filtered = removeFlag(argv, "--background");
    const command = reviewKind === "adversarial" ? "adversarial-review" : "review";
    const job = startBackgroundJob(repoRoot, SCRIPT_PATH, [command, ...filtered]);
    output(job, options.json, `Claude review started in background.\nJob ID: ${job.id}\nReview ID: ${job.reviewId}\nUse $cr:status or $cr:result ${job.id}.\n`);
    return;
  }
  const reviewId = options["review-id"];
  const payload = await runReview({
    repoRoot,
    config,
    mode,
    options,
    reviewId,
    reviewKind,
  });
  output(payload, options.json, payload.rendered);
  return payload;
}

async function runReview({ repoRoot, config, mode, options, reviewId, reviewKind }) {
  const codexContext = readOptionalCodexContext(repoRoot, options, config);
  const context = collectReviewContext({
    cwd: repoRoot,
    base: options.base,
    scope: options.scope,
    includeNearbyContext: mode.includeNearbyContext,
    userIntent: options._.join(" "),
    config,
  });
  const prompt = buildReviewPrompt({
    context,
    mode: reviewKind === "adversarial" ? "adversarial" : mode.prompt,
    codexContext,
  });
  const maxBudgetUsd = optionalNumber(options["max-budget-usd"] ?? config.maxBudgetUsd ?? null, "--max-budget-usd");
  const maxTurns = optionalPositiveInteger(options["max-turns"] ?? mode.maxTurns ?? config.maxTurns, "--max-turns");
  const model = normalizeClaudeModel(options.model ?? mode.model ?? config.defaultModel);
  const id = reviewId || `${reviewKind === "adversarial" ? "adversarial" : "review"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const createdAt = new Date().toISOString();
  const reviewMarkdown = await runClaudeText({
    cwd: repoRoot,
    prompt,
    model,
    maxTurns,
    maxBudgetUsd,
    authMode: options["auth-mode"] ?? config.authMode,
  });

  const summary = {
    reviewId: id,
    pluginName: PLUGIN_NAME,
    pluginVersion: PLUGIN_VERSION,
    kind: reviewKind,
    mode: mode.name,
    status: "completed",
    target: context.target,
    model,
    maxBudgetUsd,
    maxTurns,
    codexContextFile: codexContext?.path ?? null,
    codexContextBytes: codexContext?.bytes ?? 0,
    codexContextRedactions: codexContext?.redactions ?? [],
    createdAt,
  };
  const artifacts = {
    "context.json": context,
    "prompt.md": prompt,
    "raw-output.txt": reviewMarkdown,
    "review.md": renderReview(reviewMarkdown, { ...summary, artifactDir: reviewDir(repoRoot, id) }),
    "summary.json": summary,
  };
  if (codexContext) {
    artifacts["codex-context.md"] = codexContext.content;
  }
  const artifactDir = writeReviewArtifacts(repoRoot, id, artifacts);
  const rendered = renderReview(reviewMarkdown, { ...summary, artifactDir });
  return { ...summary, artifactDir, reviewMarkdown, rendered };
}

async function reviewFix(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const mode = resolveMode(options.mode, config);
  const payload = await runReview({
    repoRoot,
    config,
    mode,
    options,
    reviewId: options["review-id"],
    reviewKind: "review",
  });
  const decisions = {
    review_id: payload.reviewId,
    decisions: [],
  };
  const decisionsPath = path.join(payload.artifactDir, "decisions.json");
  writeJson(decisionsPath, decisions);
  const nextInstruction = "Codex must now validate each finding, apply accepted fixes itself, run tests, and update decisions.json.";
  output(
    { ...payload, decisionsPath, nextInstruction },
    options.json,
    `${payload.rendered}\nDecision template written to ${decisionsPath}.\n${nextInstruction}\n`
  );
}

async function implement(argv) {
  const options = parseArgs(argv);
  if (options["max-turns"] != null) optionalPositiveInteger(options["max-turns"], "--max-turns");
  if (options["max-budget-usd"] != null) optionalNumber(options["max-budget-usd"], "--max-budget-usd");
  const task = options._.join(" ").trim();
  if (!task) {
    throw new Error("implement requires a task description.");
  }
  const repoRoot = repoRootFromCwd();
  assertNoTrackedChanges(repoRoot, "implement requires the main checkout to have no staged or unstaged tracked changes.");
  const config = loadConfig(repoRoot);
  const codexContext = readOptionalCodexContext(repoRoot, options, config);
  const runId = options["run-id"] || createReviewId("implement");
  const branch = options.branch || `codex/claude-implement-${safeId(runId)}`;
  const baseBranch = getBranchName(repoRoot);
  const baseCommit = gitOutput(repoRoot, ["rev-parse", "HEAD"]);
  const worktreeDir = options["worktree-dir"]
    ? path.resolve(repoRoot, options["worktree-dir"])
    : path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-${safeId(runId)}`);
  const artifactDir = implementRunDir(repoRoot, runId);
  const createdAt = new Date().toISOString();

  if (fs.existsSync(worktreeDir)) {
    throw new Error(`Worktree path already exists: ${worktreeDir}`);
  }
  runCommandChecked("git", ["worktree", "add", "-b", branch, worktreeDir, "HEAD"], { cwd: repoRoot });

  const model = normalizeClaudeModel(options.model ?? config.defaultModel ?? "sonnet");
  const maxTurns = optionalPositiveInteger(options["max-turns"] ?? config.maxTurns ?? 4, "--max-turns");
  const maxBudgetUsd = optionalNumber(options["max-budget-usd"] ?? config.maxBudgetUsd ?? null, "--max-budget-usd");
  const prompt = buildImplementationPrompt({ task, repoRoot, worktreeDir, codexContext });
  let claudeOutput = "";
  let status = "needs-codex-review";
  let error = null;
  try {
    claudeOutput = await runClaudeText({
      cwd: worktreeDir,
      prompt,
      model,
      maxTurns,
      maxBudgetUsd,
      authMode: options["auth-mode"] ?? config.authMode,
      tools: ["Read", "Glob", "Grep", "LS", "Edit", "Write", "MultiEdit"],
      disallowedTools: ["NotebookEdit", "Bash", "WebFetch", "WebSearch"],
    });
  } catch (caught) {
    status = "failed";
    error = caught.message;
  }

  const changedFiles = worktreeChangedFiles(worktreeDir);
  const diff = worktreeDiff(worktreeDir);
  const diffStat = worktreeDiffStat(worktreeDir);
  const summary = {
    runId,
    pluginName: PLUGIN_NAME,
    pluginVersion: PLUGIN_VERSION,
    kind: "implement",
    status,
    task,
    repoRoot,
    worktreeDir,
    branch,
    baseBranch,
    baseCommit,
    model,
    maxBudgetUsd,
    maxTurns,
    changedFiles,
    codexContextFile: codexContext?.path ?? null,
    codexContextBytes: codexContext?.bytes ?? 0,
    codexContextRedactions: codexContext?.redactions ?? [],
    createdAt,
    error,
    claudeAllowedTools: ["Read", "Glob", "Grep", "LS", "Edit", "Write", "MultiEdit"],
    claudeDisallowedTools: ["NotebookEdit", "Bash", "WebFetch", "WebSearch"],
    nextStep: status === "needs-codex-review"
      ? "Codex must inspect claude.diff, run tests in the worktree, then run implement-accept or implement-reject."
      : "Claude implementation failed. Inspect raw-output.txt and run implement-reject to clean up the worktree.",
  };
  fs.mkdirSync(artifactDir, { recursive: true });
  writeJson(path.join(artifactDir, "summary.json"), summary);
  fs.writeFileSync(path.join(artifactDir, "prompt.md"), ensureTrailingNewline(prompt));
  fs.writeFileSync(path.join(artifactDir, "raw-output.txt"), ensureTrailingNewline(claudeOutput || ""));
  fs.writeFileSync(path.join(artifactDir, "claude.diff"), ensureTrailingNewline(diff));
  fs.writeFileSync(path.join(artifactDir, "diff-stat.txt"), ensureTrailingNewline(diffStat));
  if (codexContext) {
    fs.writeFileSync(path.join(artifactDir, "codex-context.md"), ensureTrailingNewline(codexContext.content));
  }
  writeJson(path.join(artifactDir, "decision.json"), {
    run_id: runId,
    decision: "pending",
    reason: "",
    tests_run: [],
    files_reviewed_by_codex: [],
  });

  const rendered = renderImplementSummary(summary, artifactDir);
  output({ ...summary, artifactDir, claudeOutput, rendered }, options.json, rendered);
  if (status === "failed") process.exitCode = 1;
}

async function implementAccept(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const runId = options._[0];
  if (!runId) throw new Error("implement-accept requires a run id.");
  const artifactDir = implementRunDir(repoRoot, runId);
  const summaryPath = path.join(artifactDir, "summary.json");
  if (!fs.existsSync(summaryPath)) throw new Error(`Implement run not found: ${runId}`);
  const summary = readJson(summaryPath);
  if (summary.status !== "needs-codex-review") {
    throw new Error(`Implement run ${runId} is ${summary.status}; only needs-codex-review runs can be accepted.`);
  }
  if (!fs.existsSync(summary.worktreeDir)) {
    throw new Error(`Worktree not found for run ${runId}: ${summary.worktreeDir}`);
  }
  assertNoTrackedChanges(repoRoot, "implement-accept requires the main checkout to have no staged or unstaged tracked changes.");
  const changedFiles = worktreeChangedFiles(summary.worktreeDir);
  if (!changedFiles.length) {
    throw new Error("implement-accept requires at least one changed file in the Claude worktree.");
  }
  const testsRun = options["tests-run"] ? [options["tests-run"]] : [];
  const commitMessage = options.message || `Accept Claude implementation ${runId}`;
  runCommandChecked("git", ["add", "-A"], { cwd: summary.worktreeDir });
  const commit = runCommand("git", ["commit", "-m", commitMessage], { cwd: summary.worktreeDir });
  if (commit.status !== 0) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }
  const commitSha = gitOutput(summary.worktreeDir, ["rev-parse", "HEAD"]);
  runCommandChecked("git", ["merge", "--ff-only", summary.branch], { cwd: repoRoot });
  const cleanup = options["keep-worktree"] ? { kept: true } : cleanupImplementationWorktree(repoRoot, summary);
  const acceptedAt = new Date().toISOString();
  const nextSummary = {
    ...summary,
    status: "accepted",
    changedFiles,
    acceptedAt,
    acceptedCommit: commitSha,
    testsRun,
    codexReviewNote: options["review-note"] ?? "",
    cleanup,
  };
  writeJson(summaryPath, nextSummary);
  writeJson(path.join(artifactDir, "decision.json"), {
    run_id: runId,
    decision: "accepted",
    reason: options["review-note"] ?? "Accepted by Codex after diff review.",
    tests_run: testsRun,
    files_reviewed_by_codex: changedFiles,
    accepted_commit: commitSha,
  });
  output({ ...nextSummary, artifactDir }, options.json, `Accepted Claude implementation ${runId}.\nCommit: ${commitSha}\nCleanup: ${cleanup.kept ? "kept worktree" : "removed worktree and branch"}\n`);
}

async function implementReject(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const runId = options._[0];
  if (!runId) throw new Error("implement-reject requires a run id.");
  const artifactDir = implementRunDir(repoRoot, runId);
  const summaryPath = path.join(artifactDir, "summary.json");
  if (!fs.existsSync(summaryPath)) throw new Error(`Implement run not found: ${runId}`);
  const summary = readJson(summaryPath);
  const cleanup = cleanupImplementationWorktree(repoRoot, summary, { force: true });
  const rejectedAt = new Date().toISOString();
  const reason = options.reason || "Rejected by Codex.";
  const nextSummary = {
    ...summary,
    status: "rejected",
    rejectedAt,
    rejectReason: reason,
    cleanup,
  };
  writeJson(summaryPath, nextSummary);
  writeJson(path.join(artifactDir, "decision.json"), {
    run_id: runId,
    decision: "rejected",
    reason,
    tests_run: [],
    files_reviewed_by_codex: summary.changedFiles ?? [],
  });
  output({ ...nextSummary, artifactDir }, options.json, `Rejected Claude implementation ${runId}.\nCleanup: removed worktree and branch\n`);
}

async function verify(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const selected = resolveReview(repoRoot, options["review-id"] || options._[0]);
  const reviewMarkdownPath = path.join(selected.dir, "review.md");
  const reviewMarkdown = fs.existsSync(reviewMarkdownPath)
    ? fs.readFileSync(reviewMarkdownPath, "utf8")
    : "";
  const decisionsPath = path.join(selected.dir, "decisions.json");
  if (!fs.existsSync(decisionsPath)) {
    throw new Error("verify requires decisions.json with at least one accepted/rejected/deferred decision.");
  }
  const decisions = readJson(decisionsPath);
  validateDecisions({ review_id: decisions.review_id, decisions: decisions.decisions ?? [] });
  if (!Array.isArray(decisions.decisions) || decisions.decisions.length === 0) {
    throw new Error("verify requires decisions.json with at least one accepted/rejected/deferred decision.");
  }
  const mode = resolveMode(options.mode ?? "standard", config);
  const context = collectReviewContext({
    cwd: repoRoot,
    base: options.base,
    scope: options.scope,
    includeNearbyContext: mode.includeNearbyContext,
    config,
  });
  const codexContext = readOptionalCodexContext(repoRoot, options, config);
  const prompt = buildVerificationPrompt({ review: reviewMarkdown, decisions, context, codexContext });
  const verificationMarkdown = await runClaudeText({
    cwd: repoRoot,
    prompt,
    model: normalizeClaudeModel(options.model ?? mode.model),
    maxTurns: optionalPositiveInteger(options["max-turns"] ?? mode.maxTurns, "--max-turns"),
    maxBudgetUsd: optionalNumber(options["max-budget-usd"] ?? config.maxBudgetUsd ?? null, "--max-budget-usd"),
    authMode: options["auth-mode"] ?? config.authMode,
  });
  const artifacts = {
    "verification.md": verificationMarkdown,
    "raw-verification-output.txt": verificationMarkdown,
  };
  if (codexContext) {
    artifacts["verification-codex-context.md"] = codexContext.content;
  }
  writeReviewArtifacts(repoRoot, selected.id, artifacts);
  output({ reviewId: selected.id, verificationMarkdown }, options.json, `${verificationMarkdown.trim()}\n`);
}

async function status(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const limit = optionalPositiveInteger(options.limit ?? 10, "--limit");
  const allReviews = listReviews(repoRoot);
  const currentReviews = allReviews.filter(isCurrentPluginReview);
  const legacyReviews = allReviews.filter((review) => !isCurrentPluginReview(review));
  const payload = {
    jobs: listJobs(repoRoot),
    reviews: options["current-plugin"] ? currentReviews : allReviews,
    currentReviews,
    legacyReviews,
    currentPlugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION },
    filter: options["current-plugin"] ? "current-plugin" : "all",
    limit,
  };
  output(payload, options.json, renderStatus(payload));
}

async function result(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const idOrJob = options._[0];
  const selected = resolveReview(repoRoot, idOrJob);
  if (selected.job) {
    output(selected.job, options.json, `${JSON.stringify(selected.job, null, 2)}\n`);
    return;
  }
  const reviewPath = path.join(selected.dir, "review.md");
  const summaryPath = path.join(selected.dir, "summary.json");
  const payload = {
    id: selected.id,
    dir: selected.dir,
    summary: fs.existsSync(summaryPath) ? readJson(summaryPath) : null,
    reviewMarkdown: fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, "utf8") : null,
  };
  if (options.json) {
    output(payload, true);
  } else {
    const markdown = path.join(selected.dir, "review.md");
    process.stdout.write(fs.existsSync(markdown) ? fs.readFileSync(markdown, "utf8") : `${JSON.stringify(payload, null, 2)}\n`);
  }
}

async function cancel(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const jobId = options._[0];
  if (!jobId) throw new Error("cancel requires a job id.");
  const job = cancelJob(repoRoot, jobId);
  output(job, options.json, `Job ${job.id}: ${job.status}\n`);
}

async function internalRunJob(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const jobId = options["job-id"];
  const reviewId = options["review-id"];
  if (!jobId || !reviewId) throw new Error("internal-run-job requires --job-id and --review-id.");
  const commandIndex = argv.findIndex((arg) => arg === "review" || arg === "adversarial-review");
  if (commandIndex < 0) throw new Error("internal-run-job requires review command args.");
  const command = argv[commandIndex];
  const commandArgs = argv.slice(commandIndex + 1);
  try {
    patchJob(repoRoot, jobId, { status: "running", startedAt: new Date().toISOString() });
    const reviewKind = command === "adversarial-review" ? "adversarial" : "review";
    const opts = parseArgs(commandArgs);
    const config = loadConfig(repoRoot);
    const mode = resolveMode(opts.mode ?? (reviewKind === "adversarial" ? "adversarial" : undefined), config);
    await runReview({ repoRoot, config, mode, options: opts, reviewId, reviewKind });
    const current = readJob(repoRoot, jobId);
    if (current?.status === "cancel-requested" || current?.status === "cancelled") {
      patchJob(repoRoot, jobId, { status: "cancelled", finishedAt: new Date().toISOString(), exitCode: null, error: current.error ?? "Cancelled by user." });
    } else {
      patchJob(repoRoot, jobId, { status: "completed", finishedAt: new Date().toISOString(), exitCode: 0 });
    }
  } catch (error) {
    const current = readJob(repoRoot, jobId);
    if (current?.status === "cancel-requested" || current?.status === "cancelled") {
      patchJob(repoRoot, jobId, { status: "cancelled", finishedAt: new Date().toISOString(), exitCode: null, error: current.error ?? "Cancelled by user." });
    } else {
      patchJob(repoRoot, jobId, { status: "failed", finishedAt: new Date().toISOString(), exitCode: 1, error: error.message });
    }
    process.exitCode = 1;
  }
}

function implementRunRoot(repoRoot) {
  return path.join(artifactRoot(repoRoot), "implement-runs");
}

function implementRunDir(repoRoot, runId) {
  return path.join(implementRunRoot(repoRoot), safeId(runId));
}

function buildImplementationPrompt({ task, repoRoot, worktreeDir, codexContext = null }) {
  return [
    "<role>",
    "You are Claude Code implementing a change under Codex supervision.",
    "You may edit files only inside the supplied disposable git worktree.",
    "Do not stage, commit, push, create branches, delete the worktree, install packages, or run shell commands.",
    "Codex is the reviewer and merge gate. Codex will inspect the diff, run tests, and decide accept or reject.",
    "</role>",
    "",
    "<task>",
    task,
    "</task>",
    "",
    ...implementationContextBlock(codexContext),
    "",
    "<workspace>",
    `Repository root: ${repoRoot}`,
    `Disposable worktree: ${worktreeDir}`,
    "</workspace>",
    "",
    "<output_contract>",
    "Return a concise implementation summary and list files changed.",
    "Do not include patch text in the response.",
    "</output_contract>",
  ].join("\n");
}

function implementationContextBlock(codexContext) {
  if (!codexContext?.content) return [];
  return [
    "<codex_context>",
    `Source file: ${codexContext.path}`,
    "",
    codexContext.content,
    "</codex_context>",
  ];
}

function renderImplementSummary(summary, artifactDir) {
  return [
    "Claude implementation run",
    `Run ID: ${summary.runId}`,
    `Status: ${summary.status}`,
    `Branch: ${summary.branch}`,
    `Worktree: ${summary.worktreeDir}`,
    `Artifacts: ${artifactDir}`,
    `Changed files: ${summary.changedFiles.length ? summary.changedFiles.join(", ") : "none"}`,
    summary.error ? `Error: ${summary.error}` : null,
    "",
    summary.nextStep,
    "",
  ].filter((line) => line != null).join("\n");
}

function worktreeChangedFiles(worktreeDir) {
  const diffFiles = gitMaybe(worktreeDir, ["diff", "--name-only"]).trim().split("\n").filter(Boolean);
  const untracked = gitMaybe(worktreeDir, ["ls-files", "--others", "--exclude-standard"]).trim().split("\n").filter(Boolean);
  return [...new Set([...diffFiles, ...untracked])];
}

function worktreeUntrackedFiles(worktreeDir) {
  return gitMaybe(worktreeDir, ["ls-files", "--others", "--exclude-standard"]).trim().split("\n").filter(Boolean);
}

function worktreeDiff(worktreeDir) {
  const pieces = [gitMaybe(worktreeDir, ["diff", "--binary"])];
  for (const file of worktreeUntrackedFiles(worktreeDir)) {
    pieces.push(gitDiffNoIndex(worktreeDir, ["--binary", "--", "/dev/null", file]));
  }
  return pieces.filter(Boolean).join("\n");
}

function worktreeDiffStat(worktreeDir) {
  const pieces = [gitMaybe(worktreeDir, ["diff", "--stat"])];
  for (const file of worktreeUntrackedFiles(worktreeDir)) {
    pieces.push(gitDiffNoIndex(worktreeDir, ["--stat", "--", "/dev/null", file]));
  }
  return pieces.filter(Boolean).join("\n");
}

function gitDiffNoIndex(cwd, args) {
  const result = runCommand("git", ["diff", "--no-index", ...args], { cwd });
  if (result.error || ![0, 1].includes(result.status)) {
    return "";
  }
  return result.stdout;
}

function cleanupImplementationWorktree(repoRoot, summary, options = {}) {
  const cleanup = {
    kept: false,
    worktreeRemoved: false,
    branchDeleted: false,
  };
  if (summary.worktreeDir && fs.existsSync(summary.worktreeDir)) {
    const args = ["worktree", "remove"];
    if (options.force) args.push("--force");
    args.push(summary.worktreeDir);
    runCommandChecked("git", args, { cwd: repoRoot });
    cleanup.worktreeRemoved = true;
  }
  if (summary.branch) {
    const deleteResult = runCommand("git", ["branch", options.force ? "-D" : "-d", summary.branch], { cwd: repoRoot });
    if (deleteResult.status === 0) {
      cleanup.branchDeleted = true;
    } else if (!deleteResult.stderr.includes("not found") && !deleteResult.stderr.includes("branch not found")) {
      throw new Error(`git branch delete failed: ${deleteResult.stderr || deleteResult.stdout}`);
    }
  }
  return cleanup;
}

function assertNoTrackedChanges(repoRoot, message) {
  const staged = runCommand("git", ["diff", "--cached", "--quiet"], { cwd: repoRoot });
  const unstaged = runCommand("git", ["diff", "--quiet"], { cwd: repoRoot });
  if (staged.status !== 0 || unstaged.status !== 0) {
    throw new Error(message);
  }
}

function getBranchName(repoRoot) {
  const branch = gitMaybe(repoRoot, ["branch", "--show-current"]).trim();
  return branch || "HEAD";
}

function gitOutput(cwd, args) {
  return runCommandChecked("git", args, { cwd }).stdout.trim();
}

function gitMaybe(cwd, args) {
  const result = runCommand("git", args, { cwd });
  if (result.error || result.status !== 0) {
    return "";
  }
  return result.stdout;
}

function ensureTrailingNewline(value) {
  const text = String(value ?? "");
  return text.endsWith("\n") ? text : `${text}\n`;
}

function resolveReview(repoRoot, idOrJob) {
  if (idOrJob) {
    const job = readJob(repoRoot, idOrJob);
    const reviewId = job?.reviewId ?? idOrJob;
    const dir = reviewDir(repoRoot, reviewId);
    const hasReviewArtifacts = fs.existsSync(path.join(dir, "review.md")) || fs.existsSync(path.join(dir, "summary.json"));
    if (fs.existsSync(dir) && (!job || hasReviewArtifacts)) return { id: reviewId, dir };
    const jobInfo = job ? jobResultInfo(repoRoot, idOrJob) : null;
    if (jobInfo) return { id: reviewId, job: jobInfo };
    throw new Error(`Review not found: ${idOrJob}.`);
  }
  const latest = latestReview(repoRoot);
  if (!latest) throw new Error("No Claude Review for Codex artifacts found.");
  return latest;
}

function removeFlag(argv, flag) {
  return argv.filter((arg) => arg !== flag);
}

function output(payload, asJson, text = null) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (text != null) {
    process.stdout.write(text);
  }
}

function optionalNumber(value, label = "value") {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected ${label} to be a numeric value, got ${value}.`);
  }
  return number;
}

function optionalPositiveInteger(value, label = "value") {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Expected ${label} to be a positive integer, got ${value}.`);
  }
  return number;
}

function validateScope(scope) {
  if (scope == null || scope === "") return;
  if (!["working-tree", "branch"].includes(scope)) {
    throw new Error(`Invalid --scope "${scope}". Use working-tree or branch.`);
  }
}

function isCurrentPluginReview(review) {
  return review.summary?.pluginName === PLUGIN_NAME && review.summary?.pluginVersion === PLUGIN_VERSION;
}

function addGitignoreEntry(repoRoot) {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  const desiredEntry = ".codex/claude-reviews/";
  const broaderEntry = ".codex/";
  const broaderEntryNoSlash = ".codex";
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(desiredEntry) || lines.includes(broaderEntry) || lines.includes(broaderEntryNoSlash)) {
    return {
      path: gitignorePath,
      changed: false,
      message: `${desiredEntry} already ignored.`,
    };
  }
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  const comment = existing.includes("# Claude Review for Codex") ? "" : "# Claude Review for Codex artifacts\n";
  fs.writeFileSync(gitignorePath, `${existing}${prefix}${comment}${desiredEntry}\n`);
  return {
    path: gitignorePath,
    changed: true,
    message: `Added ${desiredEntry} to .gitignore.`,
  };
}

function readOptionalCodexContext(repoRoot, options, config) {
  const requestedPath = options["codex-context-file"];
  if (requestedPath == null || requestedPath === "") return null;
  const resolvedPath = path.resolve(repoRoot, requestedPath);
  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    throw new Error(`--codex-context-file not found: ${requestedPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`--codex-context-file must point to a file: ${requestedPath}`);
  }
  if (stat.size > MAX_CODEX_CONTEXT_BYTES) {
    throw new Error(`--codex-context-file exceeds ${MAX_CODEX_CONTEXT_BYTES} bytes: ${requestedPath}`);
  }
  let content = fs.readFileSync(resolvedPath, "utf8");
  const redactions = [];
  if (config.redactSecrets !== false) {
    const redacted = redactText(content);
    content = redacted.text;
    redactions.push(...redacted.redactions);
  }
  return {
    path: path.relative(repoRoot, resolvedPath) || path.basename(resolvedPath),
    absolutePath: resolvedPath,
    bytes: stat.size,
    redactions,
    content,
  };
}

function wantsJson(argv) {
  return argv.includes("--json");
}

function outputError({ command, message }) {
  output({
    ok: false,
    error: {
      command,
      message,
    },
  }, true);
}

await main();
