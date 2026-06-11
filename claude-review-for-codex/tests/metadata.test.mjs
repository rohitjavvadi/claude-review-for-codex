import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PLUGIN_ROOT } from "./helpers.mjs";

test("plugin metadata has required paths and no placeholders", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "claude-review-for-codex");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.hooks, "./hooks/hooks.json");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.doesNotMatch(JSON.stringify(manifest), /\[TODO:/);
});

test("README documents billing and hook defaults", () => {
  const readme = fs.readFileSync(path.join(PLUGIN_ROOT, "README.md"), "utf8");
  assert.match(readme, /Experimental v0\.1/);
  assert.match(readme, /## Quick Install/);
  assert.match(readme, /node scripts\/doctor\.mjs/);
  assert.match(readme, /Codex local marketplace path/);
  assert.match(readme, /June 15, 2026/);
  assert.match(readme, /Hooks are disabled by default/);
  assert.match(readme, /max-budget-usd/);
  assert.match(readme, /fable 5/);
  assert.match(readme, /fallback-model/);
  assert.match(readme, /--effort low\|medium\|high\|xhigh\|max\|ultracode/);
  assert.match(readme, /--workflow/);
  assert.match(readme, /Claude is advisory only/);
  assert.match(readme, /Add this to the target repository's `.gitignore`/);
  assert.match(readme, /\$cr:setup --add-gitignore/);
  assert.match(readme, /status --current-plugin/);
  assert.match(readme, /Created by `review` and `adversarial-review`/);
  assert.match(readme, /Created by `review-fix`/);
  assert.match(readme, /Created by `verify`/);
  assert.match(readme, /\$cr:implement/);
  assert.match(readme, /events\.ndjson/);
  assert.match(readme, /risk-summary\.json/);
  assert.match(readme, /implement-status/);
  assert.match(readme, /--dry-run/);
  assert.match(readme, /implement-accept/);
  assert.match(readme, /implement-reject/);
});

test("root install doctor exists", () => {
  const repoRoot = path.dirname(PLUGIN_ROOT);
  const rootDoctor = path.join(repoRoot, "scripts", "doctor.mjs");
  const pluginDoctor = path.join(PLUGIN_ROOT, "scripts", "doctor.mjs");
  assert.ok(fs.existsSync(pluginDoctor));
  assert.match(fs.readFileSync(pluginDoctor, "utf8"), /Codex local marketplace path/);
  assert.match(fs.readFileSync(pluginDoctor, "utf8"), /installed plugin diagnostics mode/);

  const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
  if (fs.existsSync(marketplacePath)) {
    assert.ok(fs.existsSync(rootDoctor));
    assert.match(fs.readFileSync(rootDoctor, "utf8"), /Codex local marketplace path/);
  }
});

test("root install doctor tolerates a missing optional Claude CLI", () => {
  const repoRoot = path.dirname(PLUGIN_ROOT);
  const rootDoctor = path.join(repoRoot, "scripts", "doctor.mjs");
  const marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json");
  if (!fs.existsSync(marketplacePath)) return;

  const gitPath = spawnSync("sh", ["-lc", "command -v git"], { encoding: "utf8" }).stdout.trim();
  assert.ok(gitPath);

  const tempBin = fs.mkdtempSync(path.join(os.tmpdir(), "crfc-doctor-bin-"));
  try {
    writeShim(path.join(tempBin, "node"), process.execPath);
    writeShim(path.join(tempBin, "git"), gitPath);

    const result = spawnSync(process.execPath, [rootDoctor], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PATH: tempBin },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ok: node/);
    assert.match(result.stdout, /ok: git/);
    assert.match(result.stdout, /optional missing: claude/);
  } finally {
    fs.rmSync(tempBin, { recursive: true, force: true });
  }
});

function writeShim(file, target) {
  fs.writeFileSync(file, `#!/bin/sh\nexec "${target}" "$@"\n`);
  fs.chmodSync(file, 0o755);
}
