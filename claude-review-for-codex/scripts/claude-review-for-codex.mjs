#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, resolveMode, saveConfig } from "./lib/config.mjs";
import { collectReviewContext, ensureGitRepository, estimateContext } from "./lib/git.mjs";
import { getClaudeStatus, normalizeClaudeModel, runClaudeText } from "./lib/claude.mjs";
import { buildReviewPrompt, buildVerificationPrompt } from "./lib/prompts.mjs";
import { validateDecisions } from "./lib/schema.mjs";
import { artifactRoot, latestReview, listReviews, readJson, reviewDir, writeJson, writeReviewArtifacts } from "./lib/artifacts.mjs";
import { cancelJob, jobResultInfo, listJobs, patchJob, readJob, startBackgroundJob } from "./lib/jobs.mjs";
import { renderReview, renderStatus } from "./lib/render.mjs";
import { redactText } from "./lib/redaction.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const MAX_CODEX_CONTEXT_BYTES = 128 * 1024;
const PLUGIN_NAME = "claude-review-for-codex";
const PLUGIN_VERSION = "0.1.2";

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
    if (["json", "background", "enable-hooks", "disable-hooks", "clear-budget", "add-gitignore", "current-plugin", "help", "h"].includes(key)) {
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
