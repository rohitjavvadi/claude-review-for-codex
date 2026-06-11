#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, resolveMode, saveConfig } from "./lib/config.mjs";
import { collectReviewContext, ensureGitRepository, estimateContext } from "./lib/git.mjs";
import { getClaudeStatus, isUltracodeEffort, normalizeClaudeEffort, normalizeClaudeModel, normalizeClaudeModelList, runClaudeStream, runClaudeText } from "./lib/claude.mjs";
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
const PLUGIN_VERSION = "0.1.5";
const IMPLEMENT_WRITE_TOOLS = ["Read", "Glob", "Grep", "LS", "Edit", "Write", "MultiEdit"];
const IMPLEMENT_DENIED_TOOLS = ["NotebookEdit", "Bash", "WebFetch", "WebSearch"];
const DEFAULT_IMPLEMENT_DENY_PATTERNS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  ".git/**",
  ".codex/**",
  "node_modules/**",
];
const RISKY_IMPLEMENT_PATTERNS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "migrations/**",
  "db/migrations/**",
  ".github/workflows/**",
];

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
      case "implement-status":
        return await implementStatus(argv);
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
  review: "Usage: claude-review-for-codex review [--background] [--mode cheap|standard|deep] [--base <ref>] [--scope working-tree|branch] [--codex-context-file <path>] [--model <model>] [--fallback-model <model[,model]>] [--effort low|medium|high|xhigh|max|ultracode] [--workflow|--ultracode] [--max-turns <n>] [--max-budget-usd <amount>] [--json]",
  "adversarial-review": "Usage: claude-review-for-codex adversarial-review [--background] [--base <ref>] [--scope working-tree|branch] [--codex-context-file <path>] [--model <model>] [--fallback-model <model[,model]>] [--effort low|medium|high|xhigh|max|ultracode] [--workflow|--ultracode] [--max-turns <n>] [--max-budget-usd <amount>] [--json] [focus text]",
  "review-fix": "Usage: claude-review-for-codex review-fix [--review-id <id>] [--codex-context-file <path>] [review args...] [--json]",
  implement: "Usage: claude-review-for-codex implement [--stream|--no-stream] [--allow <glob>] [--deny <glob>] [--allow-risky] [--test-cmd <cmd>] [--timeout-ms <n>] [--codex-context-file <path>] [--worktree-dir <path>] [--branch <name>] [--model <model>] [--fallback-model <model[,model]>] [--effort low|medium|high|xhigh|max|ultracode] [--workflow|--ultracode] [--max-turns <n>] [--max-budget-usd <amount>] [--json] <task>",
  "implement-status": "Usage: claude-review-for-codex implement-status <run-id> [--json]",
  "implement-accept": "Usage: claude-review-for-codex implement-accept <run-id> [--message <commit message>] [--tests-run <summary>] [--test-cmd <cmd>] [--review-note <note>] [--dry-run] [--keep-worktree] [--json]",
  "implement-reject": "Usage: claude-review-for-codex implement-reject <run-id> [--reason <reason>] [--json]",
  verify: "Usage: claude-review-for-codex verify [review-id] [--review-id <id>] [--mode cheap|standard|deep] [--codex-context-file <path>] [--model <model>] [--fallback-model <model[,model]>] [--effort low|medium|high|xhigh|max|ultracode] [--workflow|--ultracode] [--max-turns <n>] [--max-budget-usd <amount>] [--json]",
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
    if (["json", "background", "stream", "no-stream", "workflow", "ultracode", "allow-risky", "dry-run", "enable-hooks", "disable-hooks", "clear-budget", "add-gitignore", "current-plugin", "keep-worktree", "help", "h"].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[++i];
    if (value == null) throw new Error(`Missing value for --${key}.`);
    if (["allow", "deny", "test-cmd"].includes(key)) {
      if (!Array.isArray(options[key])) options[key] = [];
      options[key].push(value);
    } else if ((key === "model" || key === "fallback-model") && isModelVersionSuffix(argv[i + 1])) {
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

function resolveClaudeExecutionOptions(options) {
  const rawEffort = options.effort;
  const ultracode = options.ultracode === true || isUltracodeEffort(rawEffort);
  const effort = ultracode ? "xhigh" : normalizeClaudeEffort(rawEffort ?? null);
  return {
    effort: effort || null,
    fallbackModel: normalizeClaudeModelList(options["fallback-model"] ?? null) || null,
    workflow: options.workflow === true || ultracode,
    ultracode,
  };
}

function applyWorkflowPrompt(prompt, execution) {
  if (!execution.workflow) return prompt;
  return [
    "ultracode: Run this request as a Claude Code dynamic workflow when the task warrants it.",
    "Preserve the safety, permission, scope, and output constraints in the prompt below.",
    "",
    prompt,
  ].join("\n");
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
  resolveClaudeExecutionOptions(options);
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
  const execution = resolveClaudeExecutionOptions(options);
  const basePrompt = buildReviewPrompt({
    context,
    mode: reviewKind === "adversarial" ? "adversarial" : mode.prompt,
    codexContext,
  });
  const prompt = applyWorkflowPrompt(basePrompt, execution);
  const maxBudgetUsd = optionalNumber(options["max-budget-usd"] ?? config.maxBudgetUsd ?? null, "--max-budget-usd");
  const maxTurns = optionalPositiveInteger(options["max-turns"] ?? mode.maxTurns ?? config.maxTurns, "--max-turns");
  const model = normalizeClaudeModel(options.model ?? mode.model ?? config.defaultModel);
  const fallbackModel = execution.fallbackModel;
  const effort = execution.effort;
  const id = reviewId || `${reviewKind === "adversarial" ? "adversarial" : "review"}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const createdAt = new Date().toISOString();
  const reviewMarkdown = await runClaudeText({
    cwd: repoRoot,
    prompt,
    model,
    effort,
    fallbackModel,
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
    fallbackModel,
    effort,
    workflow: execution.workflow,
    ultracode: execution.ultracode,
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
  if (options["timeout-ms"] != null) optionalPositiveInteger(options["timeout-ms"], "--timeout-ms");
  const execution = resolveClaudeExecutionOptions(options);
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
  const fallbackModel = execution.fallbackModel;
  const effort = execution.effort;
  const maxTurns = optionalPositiveInteger(options["max-turns"] ?? config.maxTurns ?? 4, "--max-turns");
  const maxBudgetUsd = optionalNumber(options["max-budget-usd"] ?? config.maxBudgetUsd ?? null, "--max-budget-usd");
  const timeoutMs = optionalPositiveInteger(options["timeout-ms"] ?? null, "--timeout-ms");
  const allowPatterns = optionList(options.allow);
  const denyPatterns = [...DEFAULT_IMPLEMENT_DENY_PATTERNS, ...optionList(options.deny)];
  const allowRisky = options["allow-risky"] === true;
  const testCommands = optionList(options["test-cmd"]);
  const stream = options["no-stream"] !== true;
  const basePrompt = buildImplementationPrompt({ task, repoRoot, worktreeDir, codexContext, allowPatterns, denyPatterns, allowRisky, testCommands, workflow: execution.workflow, ultracode: execution.ultracode });
  const prompt = applyWorkflowPrompt(basePrompt, execution);
  let claudeOutput = "";
  let status = "needs-codex-review";
  let error = null;
  let streamResult = null;
  try {
    if (stream) {
      streamResult = await runClaudeStream({
        cwd: worktreeDir,
        prompt,
        model,
        effort,
        fallbackModel,
        maxTurns,
        maxBudgetUsd,
        timeoutMs,
        authMode: options["auth-mode"] ?? config.authMode,
        tools: IMPLEMENT_WRITE_TOOLS,
        disallowedTools: IMPLEMENT_DENIED_TOOLS,
        eventsFile: path.join(artifactDir, "events.ndjson"),
        liveLogFile: path.join(artifactDir, "live.log"),
        stderrFile: path.join(artifactDir, "stderr.log"),
        onLiveEvent: options.json ? null : (chunk) => process.stdout.write(chunk),
      });
      claudeOutput = streamResult.text;
      if (streamResult.timedOut) {
        status = "timed-out";
        error = `Claude implementation exceeded timeout ${timeoutMs}ms.`;
      }
    } else {
      claudeOutput = await runClaudeText({
        cwd: worktreeDir,
        prompt,
        model,
        effort,
        fallbackModel,
        maxTurns,
        maxBudgetUsd,
        authMode: options["auth-mode"] ?? config.authMode,
        tools: IMPLEMENT_WRITE_TOOLS,
        disallowedTools: IMPLEMENT_DENIED_TOOLS,
      });
    }
  } catch (caught) {
    status = "failed";
    error = caught.message;
  }

  const changedFiles = worktreeChangedFiles(worktreeDir);
  const diff = worktreeDiff(worktreeDir);
  const diffStat = worktreeDiffStat(worktreeDir);
  const scope = evaluateImplementationScope(changedFiles, { allowPatterns, denyPatterns, allowRisky });
  const riskSummary = buildRiskSummary(changedFiles, scope);
  if (status === "needs-codex-review" && scope.blocking.length > 0) {
    status = "blocked";
    error = "Claude changed files outside the allowed scope or touched denied/risky files.";
  }
  const testResults = runImplementationTestCommands(worktreeDir, testCommands);
  if (status === "needs-codex-review" && testResults.some((result) => result.status !== 0)) {
    status = "tests-failed";
    error = "One or more --test-cmd checks failed.";
  }
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
    fallbackModel,
    effort,
    workflow: execution.workflow,
    ultracode: execution.ultracode,
    maxBudgetUsd,
    maxTurns,
    stream,
    timeoutMs,
    changedFiles,
    allowPatterns,
    denyPatterns,
    allowRisky,
    scope,
    riskSummary,
    testCommands,
    testResults,
    eventCount: streamResult?.events?.length ?? null,
    codexContextFile: codexContext?.path ?? null,
    codexContextBytes: codexContext?.bytes ?? 0,
    codexContextRedactions: codexContext?.redactions ?? [],
    createdAt,
    error,
    claudeAllowedTools: IMPLEMENT_WRITE_TOOLS,
    claudeDisallowedTools: IMPLEMENT_DENIED_TOOLS,
    nextStep: status === "needs-codex-review"
      ? "Codex must inspect claude.diff and risk-summary.json, run any additional checks in the worktree, then run implement-accept or implement-reject."
      : "Do not accept this run as-is. Inspect artifacts, then run implement-reject to clean up or rerun with explicit scope.",
  };
  fs.mkdirSync(artifactDir, { recursive: true });
  writeJson(path.join(artifactDir, "summary.json"), summary);
  fs.writeFileSync(path.join(artifactDir, "prompt.md"), ensureTrailingNewline(prompt));
  fs.writeFileSync(path.join(artifactDir, "raw-output.txt"), ensureTrailingNewline(claudeOutput || ""));
  fs.writeFileSync(path.join(artifactDir, "claude.diff"), ensureTrailingNewline(diff));
  fs.writeFileSync(path.join(artifactDir, "diff-stat.txt"), ensureTrailingNewline(diffStat));
  writeJson(path.join(artifactDir, "risk-summary.json"), riskSummary);
  writeJson(path.join(artifactDir, "test-results.json"), testResults);
  if (!stream) {
    fs.writeFileSync(path.join(artifactDir, "live.log"), ensureTrailingNewline(claudeOutput || ""));
  }
  if (codexContext) {
    fs.writeFileSync(path.join(artifactDir, "codex-context.md"), ensureTrailingNewline(codexContext.content));
  }
  writeJson(path.join(artifactDir, "decision.json"), {
    run_id: runId,
    decision: "pending",
    reason: "",
    tests_run: [],
    files_reviewed_by_codex: [],
    risk_summary: riskSummary,
  });

  const rendered = renderImplementSummary(summary, artifactDir);
  output({ ...summary, artifactDir, claudeOutput, rendered }, options.json, rendered);
  if (status === "failed") process.exitCode = 1;
}

async function implementStatus(argv) {
  const options = parseArgs(argv);
  const repoRoot = repoRootFromCwd();
  const runId = options._[0];
  if (!runId) throw new Error("implement-status requires a run id.");
  const artifactDir = implementRunDir(repoRoot, runId);
  const summaryPath = path.join(artifactDir, "summary.json");
  if (!fs.existsSync(summaryPath)) throw new Error(`Implement run not found: ${runId}`);
  const summary = readJson(summaryPath);
  const changedFiles = fs.existsSync(summary.worktreeDir) ? worktreeChangedFiles(summary.worktreeDir) : (summary.changedFiles ?? []);
  const eventsPath = path.join(artifactDir, "events.ndjson");
  const liveLogPath = path.join(artifactDir, "live.log");
  const payload = {
    ...summary,
    artifactDir,
    worktreeExists: fs.existsSync(summary.worktreeDir),
    changedFiles,
    eventCount: fs.existsSync(eventsPath) ? lineCount(eventsPath) : 0,
    lastLiveLog: fs.existsSync(liveLogPath) ? readTail(liveLogPath, 3000) : "",
    nextCommand: summary.status === "needs-codex-review"
      ? `implement-accept ${runId} --tests-run "<checks>"`
      : summary.status === "accepted" || summary.status === "rejected"
        ? null
        : `implement-reject ${runId} --reason "<reason>"`,
  };
  const text = [
    "Claude implementation status",
    `Run ID: ${runId}`,
    `Status: ${payload.status}`,
    `Worktree exists: ${payload.worktreeExists ? "yes" : "no"}`,
    `Changed files: ${changedFiles.length ? changedFiles.join(", ") : "none"}`,
    `Events: ${payload.eventCount}`,
    payload.nextCommand ? `Next: ${payload.nextCommand}` : null,
    payload.lastLiveLog ? `\nRecent live log:\n${payload.lastLiveLog.trim()}\n` : "",
  ].filter((line) => line != null).join("\n");
  output(payload, options.json, `${text}\n`);
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
  const scope = evaluateImplementationScope(changedFiles, {
    allowPatterns: summary.allowPatterns ?? [],
    denyPatterns: summary.denyPatterns ?? DEFAULT_IMPLEMENT_DENY_PATTERNS,
    allowRisky: summary.allowRisky === true,
  });
  if (scope.blocking.length > 0) {
    throw new Error(`implement-accept blocked by scope/risk violations: ${scope.blocking.map((item) => `${item.path} (${item.reason})`).join(", ")}`);
  }
  const testCommands = [...(summary.testCommands ?? []), ...optionList(options["test-cmd"])];
  const commandResults = runImplementationTestCommands(summary.worktreeDir, optionList(options["test-cmd"]));
  if (commandResults.some((result) => result.status !== 0)) {
    throw new Error(`implement-accept blocked because --test-cmd failed: ${commandResults.map((result) => `${result.command} => ${result.status}`).join(", ")}`);
  }
  const testsRun = [...(summary.testResults ?? []), ...commandResults].map(formatTestResult);
  if (options["tests-run"]) testsRun.push(...optionList(options["tests-run"]));
  const dryRun = options["dry-run"] === true;
  const commitMessage = options.message || `Accept Claude implementation ${runId}`;
  if (dryRun) {
    const dryPayload = {
      ...summary,
      status: "dry-run",
      changedFiles,
      testsRun,
      scope,
      wouldCommitMessage: commitMessage,
      wouldMergeBranch: summary.branch,
      cleanup: { kept: true, dryRun: true },
    };
    output(dryPayload, options.json, `Dry run accept for ${runId}.\nWould commit: ${commitMessage}\nWould merge branch: ${summary.branch}\nChanged files: ${changedFiles.join(", ")}\n`);
    return;
  }
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
    scope,
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
  if (options["max-turns"] != null) optionalPositiveInteger(options["max-turns"], "--max-turns");
  if (options["max-budget-usd"] != null) optionalNumber(options["max-budget-usd"], "--max-budget-usd");
  const execution = resolveClaudeExecutionOptions(options);
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
  const basePrompt = buildVerificationPrompt({ review: reviewMarkdown, decisions, context, codexContext });
  const prompt = applyWorkflowPrompt(basePrompt, execution);
  const model = normalizeClaudeModel(options.model ?? mode.model);
  const verificationMarkdown = await runClaudeText({
    cwd: repoRoot,
    prompt,
    model,
    effort: execution.effort,
    fallbackModel: execution.fallbackModel,
    maxTurns: optionalPositiveInteger(options["max-turns"] ?? mode.maxTurns, "--max-turns"),
    maxBudgetUsd: optionalNumber(options["max-budget-usd"] ?? config.maxBudgetUsd ?? null, "--max-budget-usd"),
    authMode: options["auth-mode"] ?? config.authMode,
  });
  const artifacts = {
    "verification.md": verificationMarkdown,
    "raw-verification-output.txt": verificationMarkdown,
    "verification-summary.json": {
      reviewId: selected.id,
      model,
      fallbackModel: execution.fallbackModel,
      effort: execution.effort,
      workflow: execution.workflow,
      ultracode: execution.ultracode,
    },
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

function buildImplementationPrompt({ task, repoRoot, worktreeDir, codexContext = null, allowPatterns = [], denyPatterns = [], allowRisky = false, testCommands = [], workflow = false, ultracode = false }) {
  return [
    "<role>",
    "You are Claude Code implementing a change under Codex supervision.",
    "You may edit files only inside the supplied disposable git worktree.",
    "Do not stage, commit, push, create branches, delete the worktree, install packages, or run shell commands.",
    "Codex is the reviewer and merge gate. Codex will inspect the diff, run tests, and decide accept or reject.",
    workflow ? `Dynamic workflow requested: ${ultracode ? "ultracode" : "single workflow"}. Any workflow subagents must obey the same disposable-worktree, tool, and path-scope limits.` : null,
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
    "<codex_supervision_policy>",
    `Allowed path globs: ${allowPatterns.length ? allowPatterns.join(", ") : "(all paths except denied/risky paths)"}`,
    `Denied path globs: ${denyPatterns.join(", ")}`,
    `Risky paths require explicit allowance: ${allowRisky ? "no" : "yes"}`,
    testCommands.length ? `Codex test commands to run after Claude exits: ${testCommands.join(" && ")}` : "Codex will decide which tests to run after Claude exits.",
    "If a requested change requires a denied or risky file, stop and explain instead of editing that file.",
    "</codex_supervision_policy>",
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

function evaluateImplementationScope(changedFiles, { allowPatterns = [], denyPatterns = [], allowRisky = false } = {}) {
  const allowed = [];
  const warnings = [];
  const blocking = [];
  for (const file of changedFiles) {
    const allowMatched = allowPatterns.length === 0 || matchesAnyGlob(file, allowPatterns);
    const explicitAllowMatched = allowPatterns.length > 0 && matchesAnyGlob(file, allowPatterns);
    const denyMatched = matchesAnyGlob(file, denyPatterns);
    const riskyMatched = matchesAnyGlob(file, RISKY_IMPLEMENT_PATTERNS);
    if (!allowMatched) {
      blocking.push({ path: file, reason: "outside-allow-scope" });
      continue;
    }
    if (denyMatched && !explicitAllowMatched) {
      blocking.push({ path: file, reason: "denied-path" });
      continue;
    }
    if (riskyMatched && !allowRisky && !explicitAllowMatched) {
      blocking.push({ path: file, reason: "risky-path-requires-explicit-allowance" });
      continue;
    }
    if (riskyMatched) {
      warnings.push({ path: file, reason: "risky-path" });
    }
    allowed.push(file);
  }
  return { allowed, warnings, blocking };
}

function buildRiskSummary(changedFiles, scope) {
  return {
    changedFiles,
    allowedFiles: scope.allowed,
    warnings: scope.warnings,
    blocking: scope.blocking,
    verdict: scope.blocking.length ? "blocked" : scope.warnings.length ? "review-carefully" : "clean",
  };
}

function runImplementationTestCommands(worktreeDir, commands) {
  return optionList(commands).map((command) => {
    const startedAt = new Date().toISOString();
    const result = runCommand("sh", ["-lc", command], { cwd: worktreeDir, maxBuffer: 2 * 1024 * 1024 });
    return {
      command,
      status: result.status,
      signal: result.signal,
      stdoutTail: tailText(result.stdout, 4000),
      stderrTail: tailText(result.stderr, 4000),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  });
}

function formatTestResult(result) {
  if (typeof result === "string") return result;
  return `${result.command}: ${result.status === 0 ? "passed" : `failed (${result.status})`}`;
}

function optionList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter((item) => item != null && item !== "") : [value].filter(Boolean);
}

function matchesAnyGlob(file, patterns) {
  return optionList(patterns).some((pattern) => globToRegExp(pattern).test(normalizePath(file)));
}

function normalizePath(value) {
  return String(value ?? "").split(path.sep).join("/");
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern);
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      out += ".*";
      i++;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  out += "$";
  return new RegExp(out);
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

function lineCount(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).length;
}

function readTail(file, maxChars = 4000) {
  return tailText(fs.readFileSync(file, "utf8"), maxChars);
}

function tailText(text, maxChars = 4000) {
  const value = String(text ?? "");
  return value.length > maxChars ? value.slice(value.length - maxChars) : value;
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
