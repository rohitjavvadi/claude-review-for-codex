#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = findMarketplaceRoot(pluginRoot);
const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
const pluginManifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");

const checks = [
  checkFile("local marketplace", marketplacePath, repoRoot === pluginRoot ? "clone the GitHub repo root, not only the plugin subfolder" : ""),
  checkFile("plugin manifest", pluginManifestPath),
  checkCommand("git", ["--version"], true),
  checkCommand("node", ["--version"], true),
  checkCommand("claude", ["--version"], false),
];

let failedRequired = false;
for (const check of checks) {
  const mark = check.ok ? "ok" : check.required ? "missing" : "optional missing";
  console.log(`${mark}: ${check.name}${check.detail ? ` (${check.detail})` : ""}`);
  if (!check.ok && check.required) failedRequired = true;
}

console.log("");
console.log("Codex local marketplace path:");
console.log(repoRoot === pluginRoot ? "(not found; use the cloned repository root that contains .agents/plugins/marketplace.json)" : repoRoot);
console.log("");
console.log("Install in Codex:");
console.log("1. Open Codex app -> Plugins.");
console.log("2. Add a local marketplace and paste the path above.");
console.log("3. Install `claude-review-for-codex`.");
console.log("4. In a repo chat, run `$cr:setup`, then `$cr:review`.");

process.exitCode = failedRequired ? 1 : 0;

function findMarketplaceRoot(start) {
  const parent = path.dirname(start);
  if (fs.existsSync(path.join(parent, ".agents", "plugins", "marketplace.json"))) {
    return parent;
  }
  if (fs.existsSync(path.join(start, ".agents", "plugins", "marketplace.json"))) {
    return start;
  }
  return start;
}

function checkFile(name, file, missingDetail = "") {
  const ok = fs.existsSync(file);
  return {
    name,
    ok,
    required: true,
    detail: ok ? path.relative(repoRoot, file) : missingDetail,
  };
}

function checkCommand(name, args, required) {
  const result = spawnSync(name, args, { encoding: "utf8" });
  const output = result.stdout.trim() || result.stderr.trim();
  return {
    name,
    ok: result.status === 0,
    required,
    detail: output.split("\n")[0] ?? "",
  };
}
