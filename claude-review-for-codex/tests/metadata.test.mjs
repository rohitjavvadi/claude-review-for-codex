import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
  assert.match(readme, /June 15, 2026/);
  assert.match(readme, /Hooks are disabled by default/);
  assert.match(readme, /max-budget-usd/);
  assert.match(readme, /Claude is advisory only/);
  assert.match(readme, /Add this to the target repository's `.gitignore`/);
  assert.match(readme, /Created by `review` and `adversarial-review`/);
  assert.match(readme, /Created by `review-fix`/);
  assert.match(readme, /Created by `verify`/);
});
