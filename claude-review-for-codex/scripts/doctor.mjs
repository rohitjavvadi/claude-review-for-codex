#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = findMarketplaceRoot(pluginRoot);
const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
const pluginManifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const hasMarketplace = fs.existsSync(marketplacePath);
const runningFromInstalledPlugin = repoRoot === pluginRoot && !hasMarketplace;

const checks = [
  checkFile(
    "local marketplace",
    marketplacePath,
    !runningFromInstalledPlugin,
    runningFromInstalledPlugin ? "not present in installed plugin cache; run the root doctor from the cloned GitHub repo for install setup" : "clone the GitHub repo root, not only the plugin subfolder"
  ),
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
if (runningFromInstalledPlugin) {
  console.log("(installed plugin diagnostics mode; local marketplace path is available only from the cloned GitHub repo root)");
  console.log("");
  console.log("Installed plugin diagnostics:");
  console.log("1. This plugin package is installed and can run its internal checks.");
  console.log("2. To install or refresh the local marketplace, run `node scripts/doctor.mjs` from the cloned repository root.");
  console.log("3. In a repo chat, run `$cr:setup`, then `$cr:review`.");
} else {
  console.log(repoRoot);
  console.log("");
  console.log("Install in Codex:");
  console.log("1. Open Codex app -> Plugins.");
  console.log("2. Add a local marketplace and paste the path above.");
  console.log("3. Install `claude-review-for-codex`.");
  console.log("4. In a repo chat, run `$cr:setup`, then `$cr:review`.");
}

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

function checkFile(name, file, required = true, missingDetail = "") {
  const ok = fs.existsSync(file);
  return {
    name,
    ok,
    required,
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
