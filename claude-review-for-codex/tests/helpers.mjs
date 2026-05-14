import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(PLUGIN_ROOT, "scripts", "claude-review-for-codex.mjs");

export function tempRepo(name = "crg-test") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  run("git", ["init"], dir);
  run("git", ["config", "user.email", "test@example.com"], dir);
  run("git", ["config", "user.name", "Test"], dir);
  return dir;
}

export function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

export function runCli(args, cwd, env = {}) {
  return run(process.execPath, [CLI, ...args], cwd, env);
}

export const FAKE_REVIEW = [
  "# Verdict",
  "Needs attention",
  "",
  "## Findings",
  "### P1: Test fixture issue",
  "File: src/app.js:1",
  "Evidence: The fixture deliberately asks for one finding.",
  "Suggested fix intent: Update the fixture or reject the finding with evidence.",
  "Confidence: 0.9",
  "",
  "## Next Steps",
  "- Validate CR-001 locally.",
].join("\n");

export const FAKE_VERIFY = [
  "# Verification",
  "Status: verified",
  "",
  "Accepted findings appear fixed.",
].join("\n");
