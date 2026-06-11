import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { binaryAvailable, runCommand } from "./process.mjs";

const MODEL_ALIASES = new Map([
  ["default", "default"],
  ["fable", "fable"],
  ["sonnet", "sonnet"],
  ["opus", "opus"],
  ["haiku", "haiku"],
  ["mythos", "claude-mythos-5"],
  ["mythos preview", "claude-mythos-preview"],
  ["opusplan", "opusplan"],
  ["opus plan", "opusplan"],
]);

const EFFORT_ALIASES = new Map([
  ["low", "low"],
  ["medium", "medium"],
  ["med", "medium"],
  ["high", "high"],
  ["extra", "xhigh"],
  ["xhigh", "xhigh"],
  ["x-high", "xhigh"],
  ["max", "max"],
  ["ultracode", "xhigh"],
  ["ultra code", "xhigh"],
  ["ultra-code", "xhigh"],
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
  const marketingName = /^(fable|mythos|opus|sonnet|haiku)\s+(\d+)(?:[.\s]+(\d+))?(?:[.\s]+(\d+))?(\[1m\])?$/.exec(claudeShorthand);
  if (marketingName) {
    const [, family, major, minor, patch, contextSuffix = ""] = marketingName;
    const versionParts = [major, minor, patch].filter(Boolean);
    return `claude-${family}-${versionParts.join("-")}${contextSuffix}`;
  }

  const dottedClaudeName = /^claude-(fable|mythos|opus|sonnet|haiku)-(\d+)\.(\d+)(.*)$/i.exec(raw);
  if (dottedClaudeName) {
    const [, family, major, minor, suffix] = dottedClaudeName;
    return `claude-${family.toLowerCase()}-${major}-${minor}${suffix}`;
  }

  return raw;
}

export function normalizeClaudeModelList(models) {
  if (models == null || models === "") return models;
  const normalized = String(models)
    .split(",")
    .map((model) => normalizeClaudeModel(model.trim()))
    .filter(Boolean);
  return normalized.length ? normalized.join(",") : "";
}

export function normalizeClaudeEffort(effort) {
  if (effort == null || effort === "") return effort;
  const raw = String(effort).trim();
  if (!raw) return raw;
  const alias = EFFORT_ALIASES.get(raw.toLowerCase().replace(/\s+/g, " "));
  if (!alias) {
    throw new Error(`Invalid --effort "${effort}". Use low, medium, high, xhigh, max, or ultracode.`);
  }
  return alias;
}

export function isUltracodeEffort(effort) {
  if (effort == null || effort === "") return false;
  const normalized = String(effort).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return normalized === "ultracode" || normalized === "ultra code";
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

const OPTIONAL_FLAGS = ["--output-format", "--max-turns", "--bare", "--model", "--max-budget-usd", "--effort", "--fallback-model"];

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

export function buildClaudeArgs({
  model,
  effort,
  fallbackModel,
  maxTurns,
  maxBudgetUsd,
  authMode = "subscription-cli",
  tools = ["Read", "Glob", "Grep", "LS"],
  disallowedTools = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch"],
  capabilities = null,
}) {
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
  if (effort && supports("--effort")) {
    args.push("--effort", normalizeClaudeEffort(effort));
  }
  if (fallbackModel && supports("--fallback-model")) {
    args.push("--fallback-model", normalizeClaudeModelList(fallbackModel));
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
  if (disallowedTools.length > 0) {
    args.push("--disallowedTools", disallowedTools.join(","));
  }
  return args;
}

export async function runClaudeText({
  cwd,
  prompt,
  model,
  effort,
  fallbackModel,
  maxTurns,
  maxBudgetUsd,
  authMode,
  tools = ["Read", "Glob", "Grep", "LS"],
  disallowedTools = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch"],
}) {
  if (process.env.CR_FAKE_CLAUDE_RESULT) {
    if (process.env.CR_FAKE_CLAUDE_WRITE_FILE) {
      writeFakeClaudeFile(cwd, process.env.CR_FAKE_CLAUDE_WRITE_FILE, process.env.CR_FAKE_CLAUDE_WRITE_CONTENT ?? "");
    }
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

  const args = buildClaudeArgs({ model, effort, fallbackModel, maxTurns, maxBudgetUsd, authMode, tools, disallowedTools, capabilities: status.capabilities });
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

export async function runClaudeStream({
  cwd,
  prompt,
  model,
  effort,
  fallbackModel,
  maxTurns,
  maxBudgetUsd,
  authMode,
  eventsFile,
  liveLogFile,
  stderrFile,
  timeoutMs = null,
  onLiveEvent = null,
  tools = ["Read", "Glob", "Grep", "LS"],
  disallowedTools = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", "WebSearch"],
}) {
  if (process.env.CR_FAKE_CLAUDE_RESULT) {
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    const fakeEvents = [];
    if (process.env.CR_FAKE_CLAUDE_WRITE_FILE) {
      const target = path.resolve(cwd, process.env.CR_FAKE_CLAUDE_WRITE_FILE);
      fakeEvents.push({
        type: "assistant",
        message: {
          content: [{
            type: "tool_use",
            name: "Write",
            input: {
              file_path: target,
              content: process.env.CR_FAKE_CLAUDE_WRITE_CONTENT ?? "",
            },
          }],
        },
      });
      writeFakeClaudeFile(cwd, process.env.CR_FAKE_CLAUDE_WRITE_FILE, process.env.CR_FAKE_CLAUDE_WRITE_CONTENT ?? "");
    }
    fakeEvents.push({
      type: "result",
      subtype: "success",
      result: process.env.CR_FAKE_CLAUDE_RESULT,
      total_cost_usd: 0,
      num_turns: 1,
    });
    const text = fakeEvents.map((event) => JSON.stringify(event)).join("\n") + "\n";
    fs.writeFileSync(eventsFile, text);
    fs.writeFileSync(liveLogFile, renderStreamText(fakeEvents));
    if (stderrFile) fs.writeFileSync(stderrFile, "");
    return {
      text: process.env.CR_FAKE_CLAUDE_RESULT,
      events: fakeEvents,
      timedOut: false,
      exitCode: 0,
    };
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

  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  const args = buildClaudeArgs({ model, effort, fallbackModel, maxTurns, maxBudgetUsd, authMode, tools, disallowedTools, capabilities: status.capabilities });
  args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
  removeFirstOutputFormatText(args);

  return await new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const events = [];
    let stdoutRemainder = "";
    let stderr = "";
    let text = "";
    let timedOut = false;
    const eventsStream = fs.createWriteStream(eventsFile, { flags: "w" });
    const liveStream = fs.createWriteStream(liveLogFile, { flags: "w" });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutRemainder += chunk;
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        eventsStream.write(`${line}\n`);
        try {
          const event = JSON.parse(line);
          events.push(event);
          const rendered = renderStreamEvent(event);
          if (rendered) {
            liveStream.write(rendered);
            if (onLiveEvent) onLiveEvent(rendered);
          }
          if (event.type === "result" && typeof event.result === "string") text = event.result;
        } catch {
          liveStream.write(`${line}\n`);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.stdin.end(prompt);

    let timer = null;
    if (timeoutMs != null) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, 1500);
      }, timeoutMs);
    }

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (stdoutRemainder.trim()) {
        eventsStream.write(`${stdoutRemainder}\n`);
      }
      eventsStream.end();
      liveStream.end();
      if (stderrFile) fs.writeFileSync(stderrFile, stderr);
      if (timedOut) {
        resolve({ text, events, timedOut: true, exitCode: code, stderr });
        return;
      }
      if (code !== 0) {
        reject(new Error(`Claude exited with ${code}: ${stderr || text}`));
        return;
      }
      resolve({ text, events, timedOut: false, exitCode: code, stderr });
    });
  });
}

function removeFirstOutputFormatText(args) {
  const index = args.findIndex((arg, i) => arg === "--output-format" && args[i + 1] === "text");
  if (index >= 0) args.splice(index, 2);
}

function renderStreamText(events) {
  return events.map(renderStreamEvent).filter(Boolean).join("");
}

function renderStreamEvent(event) {
  if (event.type === "assistant") {
    const blocks = event.message?.content ?? [];
    return blocks.map((block) => {
      if (block.type === "text") return `${block.text}\n`;
      if (block.type === "tool_use") return `[tool:${block.name}] ${JSON.stringify(block.input ?? {})}\n`;
      return "";
    }).join("");
  }
  if (event.type === "result") {
    return `[result:${event.subtype ?? "unknown"}] turns=${event.num_turns ?? "?"} cost=${event.total_cost_usd ?? "?"}\n`;
  }
  return "";
}

function writeFakeClaudeFile(cwd, relativePath, content) {
  const root = path.resolve(cwd);
  const file = path.resolve(root, relativePath);
  if (!file.startsWith(`${root}${path.sep}`) && file !== root) {
    throw new Error("CR_FAKE_CLAUDE_WRITE_FILE must stay inside the Claude working directory.");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
