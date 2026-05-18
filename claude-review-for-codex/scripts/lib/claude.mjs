import { spawn } from "node:child_process";
import { binaryAvailable, runCommand } from "./process.mjs";

const MODEL_ALIASES = new Map([
  ["default", "default"],
  ["sonnet", "sonnet"],
  ["opus", "opus"],
  ["haiku", "haiku"],
  ["opusplan", "opusplan"],
  ["opus plan", "opusplan"],
]);

export function normalizeClaudeModel(model) {
  if (model == null || model === "") return model;
  const raw = String(model).trim();
  if (!raw) return raw;
  const normalizedWhitespace = raw.replace(/\s+/g, " ");
  const alias = MODEL_ALIASES.get(normalizedWhitespace.toLowerCase());
  if (alias) return alias;

  const compactAlias = MODEL_ALIASES.get(normalizedWhitespace.toLowerCase().replace(/\s+/g, ""));
  if (compactAlias) return compactAlias;

  const claudeShorthand = normalizedWhitespace
    .toLowerCase()
    .replace(/^claude\s+/, "")
    .replace(/[_-]+/g, " ");
  const marketingName = /^(opus|sonnet)\s+(\d+)(?:[.\s]+(\d+))?(?:[.\s]+(\d+))?(\[1m\])?$/.exec(claudeShorthand);
  if (marketingName) {
    const [, family, major, minor, patch, contextSuffix = ""] = marketingName;
    const versionParts = [major, minor, patch].filter(Boolean);
    return `claude-${family}-${versionParts.join("-")}${contextSuffix}`;
  }

  const dottedClaudeName = /^claude-(opus|sonnet)-(\d+)\.(\d+)(.*)$/i.exec(raw);
  if (dottedClaudeName) {
    const [, family, major, minor, suffix] = dottedClaudeName;
    return `claude-${family.toLowerCase()}-${major}-${minor}${suffix}`;
  }

  return raw;
}

export function getClaudeStatus(cwd = process.cwd()) {
  const availability = binaryAvailable("claude", ["--version"], cwd);
  if (!availability.available) {
    return {
      available: false,
      authenticated: false,
      authValidated: false,
      detail: availability.detail || "claude CLI not found",
      capabilities: { supported: [], missingRequired: [], missingOptional: [] },
    };
  }
  const capabilities = getClaudeCapabilities(cwd);
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      available: true,
      authenticated: true,
      authValidated: false,
      detail: "ANTHROPIC_API_KEY configured; key presence is not validated until a Claude call is made",
      capabilities,
    };
  }
  const auth = binaryAvailable("claude", ["auth", "status"], cwd);
  return {
    available: true,
    authenticated: auth.available,
    authValidated: auth.available,
    detail: auth.available ? "Claude CLI authenticated" : "Claude CLI found, but auth status failed. Run `claude auth login` or set ANTHROPIC_API_KEY.",
    capabilities,
  };
}

const REQUIRED_FLAGS = [
  "--permission-mode",
  "--tools",
  "--allowedTools",
  "--disallowedTools",
  "--no-session-persistence",
];

const OPTIONAL_FLAGS = ["--output-format", "--max-turns", "--bare", "--model", "--max-budget-usd"];

export function getClaudeCapabilities(cwd = process.cwd()) {
  const help = runCommand("claude", ["--help"], { cwd, maxBuffer: 512 * 1024 });
  const text = `${help.stdout}\n${help.stderr}`;
  const supports = (flag) => text.includes(flag);
  return {
    supported: [...REQUIRED_FLAGS, ...OPTIONAL_FLAGS].filter(supports),
    missingRequired: REQUIRED_FLAGS.filter((flag) => !supports(flag)),
    missingOptional: OPTIONAL_FLAGS.filter((flag) => !supports(flag)),
  };
}

export function assertClaudeCapabilities(cwd = process.cwd()) {
  const capabilities = getClaudeCapabilities(cwd);
  if (capabilities.missingRequired.length) {
    throw new Error(
      `Claude CLI is missing required review safety flags: ${capabilities.missingRequired.join(", ")}. Update Claude Code before running Claude Review for Codex.`
    );
  }
  return capabilities;
}

export function buildClaudeArgs({ model, maxTurns, maxBudgetUsd, authMode = "subscription-cli", tools = ["Read", "Glob", "Grep", "LS"], capabilities = null }) {
  const args = ["-p", "--permission-mode", "dontAsk", "--no-session-persistence"];
  const supports = (flag) => !capabilities || !capabilities.missingOptional?.includes(flag);
  if (supports("--output-format")) {
    args.push("--output-format", "text");
  }
  if ((authMode === "api-key" || authMode === "bare") && supports("--bare")) {
    args.push("--bare");
  }
  if (model && supports("--model")) {
    args.push("--model", normalizeClaudeModel(model));
  }
  if (maxTurns && supports("--max-turns")) {
    args.push("--max-turns", String(maxTurns));
  }
  if (maxBudgetUsd != null && supports("--max-budget-usd")) {
    args.push("--max-budget-usd", String(maxBudgetUsd));
  }
  if (tools.length > 0) {
    args.push("--tools", tools.join(","));
    for (const tool of tools) {
      args.push("--allowedTools", tool);
    }
  }
  args.push("--disallowedTools", "Edit,Write,MultiEdit,NotebookEdit,Bash,WebFetch,WebSearch");
  return args;
}

export async function runClaudeText({ cwd, prompt, model, maxTurns, maxBudgetUsd, authMode }) {
  if (process.env.CR_FAKE_CLAUDE_RESULT) {
    const delay = Number(process.env.CR_FAKE_CLAUDE_DELAY_MS ?? 0);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return process.env.CR_FAKE_CLAUDE_RESULT;
  }

  const status = getClaudeStatus(cwd);
  if (!status.available || !status.authenticated) {
    throw new Error(status.detail);
  }
  if (status.capabilities.missingRequired.length) {
    throw new Error(
      `Claude CLI is missing required review safety flags: ${status.capabilities.missingRequired.join(", ")}. Update Claude Code before running Claude Review for Codex.`
    );
  }

  const args = buildClaudeArgs({ model, maxTurns, maxBudgetUsd, authMode, capabilities: status.capabilities });
  return await new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.stdin.end(prompt);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Claude exited with ${code}: ${stderr || stdout}`));
        return;
      }
      const text = stdout.trim();
      if (!text) {
        reject(new Error(`Claude returned empty output.${stderr ? `\nClaude stderr: ${stderr.slice(0, 4000)}` : ""}`));
        return;
      }
      resolve(text);
    });
  });
}
