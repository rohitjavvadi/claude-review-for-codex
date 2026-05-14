import fs from "node:fs";
import path from "node:path";

export const DEFAULT_CONFIG = {
  defaultMode: "standard",
  defaultModel: "sonnet",
  maxBudgetUsd: null,
  maxTurns: 4,
  allowOpus: false,
  allowAutoHooks: false,
  sendUntrackedFiles: true,
  redactSecrets: true,
  authMode: "subscription-cli",
  hooksEnabled: false,
};

export function repoConfigPath(repoRoot) {
  return path.join(repoRoot, ".codex", "claude-reviews", "config.json");
}

export function loadConfig(repoRoot) {
  const configPath = repoConfigPath(repoRoot);
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (raw.maxBudgetUsd === 1 && raw.budgetPolicy !== "explicit") {
    raw.maxBudgetUsd = null;
  }
  return { ...DEFAULT_CONFIG, ...raw };
}

export function saveConfig(repoRoot, updates = {}) {
  if (Object.prototype.hasOwnProperty.call(updates, "maxBudgetUsd")) {
    updates.budgetPolicy = updates.maxBudgetUsd == null ? null : "explicit";
  }
  const config = { ...loadConfig(repoRoot), ...updates };
  const configPath = repoConfigPath(repoRoot);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export const REVIEW_MODES = {
  cheap: {
    model: "sonnet",
    maxTurns: 3,
    includeNearbyContext: false,
    prompt: "standard",
  },
  standard: {
    model: "sonnet",
    maxTurns: 4,
    includeNearbyContext: true,
    prompt: "standard",
  },
  deep: {
    model: "sonnet",
    maxTurns: 8,
    includeNearbyContext: true,
    prompt: "deep",
  },
  adversarial: {
    model: "sonnet",
    maxTurns: 8,
    includeNearbyContext: true,
    prompt: "adversarial",
  },
};

export function resolveMode(name, config = DEFAULT_CONFIG) {
  const requested = name || config.defaultMode || "standard";
  const mode = REVIEW_MODES[requested];
  if (!mode) {
    throw new Error(`Unknown review mode "${requested}". Use one of: ${Object.keys(REVIEW_MODES).join(", ")}.`);
  }
  return { name: requested, ...mode };
}
