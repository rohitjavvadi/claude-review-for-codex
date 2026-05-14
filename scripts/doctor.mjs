#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
const pluginManifestPath = path.join(repoRoot, "claude-review-for-codex", ".codex-plugin", "plugin.json");

const checks = [
  checkFile("local marketplace", marketplacePath),
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
console.log(repoRoot);
console.log("");
console.log("Install in Codex:");
console.log("1. Open Codex app -> Plugins.");
console.log("2. Add a local marketplace and paste the path above.");
console.log("3. Install `claude-review-for-codex`.");
console.log("4. In a repo chat, run `$cr:setup`, then `$cr:review`.");

process.exitCode = failedRequired ? 1 : 0;

function checkFile(name, file) {
  return {
    name,
    ok: fs.existsSync(file),
    required: true,
    detail: path.relative(repoRoot, file),
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
