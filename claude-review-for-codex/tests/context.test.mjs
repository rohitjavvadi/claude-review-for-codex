import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { collectReviewContext, estimateContext } from "../scripts/lib/git.mjs";
import { run, tempRepo } from "./helpers.mjs";

test("collects working-tree context with staged, unstaged, untracked, and redaction", () => {
  const repo = tempRepo("crg-context");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "const token = 'ok';\n");
  run("git", ["add", "src/app.js"], repo);
  run("git", ["commit", "-m", "initial"], repo);
  fs.writeFileSync(path.join(repo, "src", "app.js"), "ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnop\n");
  fs.writeFileSync(path.join(repo, "new.txt"), "hello\n");

  const context = collectReviewContext({
    cwd: repo,
    scope: "working-tree",
    includeNearbyContext: true,
    config: { redactSecrets: true, sendUntrackedFiles: true },
  });
  assert.equal(context.target.scope, "working-tree");
  assert.ok(context.changed_files.includes("src/app.js"));
  assert.ok(context.changed_files.includes("new.txt"));
  assert.doesNotMatch(JSON.stringify(context), /sk-ant-1234567890/);
  assert.ok(context.redactions.length >= 1);
});

test("excludes generated artifacts from working-tree context and estimates", () => {
  const repo = tempRepo("crg-context-ignore");
  fs.mkdirSync(path.join(repo, "src"));
  fs.mkdirSync(path.join(repo, "tmp"));
  fs.writeFileSync(path.join(repo, "src", "app.js"), "console.log('base');\n");
  fs.writeFileSync(path.join(repo, "debug.log"), "old log\n");
  fs.writeFileSync(path.join(repo, "tmp", "cache.txt"), "old temp\n");
  run("git", ["add", "."], repo);
  run("git", ["commit", "-m", "initial"], repo);

  fs.writeFileSync(path.join(repo, "src", "app.js"), "console.log('review me');\n");
  fs.writeFileSync(path.join(repo, "debug.log"), "artifact-log-secret\n");
  fs.writeFileSync(path.join(repo, "tmp", "cache.txt"), "artifact-temp-secret\n");
  fs.writeFileSync(path.join(repo, "keep.txt"), "reviewable untracked\n");
  fs.mkdirSync(path.join(repo, ".codex", "claude-reviews", "latest"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".codex", "claude-reviews", "latest", "context.json"), "artifact-context-secret\n");
  fs.mkdirSync(path.join(repo, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules", "pkg", "index.js"), "artifact-module-secret\n");
  fs.mkdirSync(path.join(repo, "logs"), { recursive: true });
  fs.writeFileSync(path.join(repo, "logs", "runtime.log"), "artifact-runtime-secret\n");
  fs.writeFileSync(path.join(repo, "tmp", "scratch.tmp"), "artifact-scratch-secret\n");

  const context = collectReviewContext({
    cwd: repo,
    scope: "working-tree",
    includeNearbyContext: true,
    config: { redactSecrets: false, sendUntrackedFiles: true },
  });
  const serialized = JSON.stringify(context);

  assert.deepEqual(context.changed_files.sort(), ["keep.txt", "src/app.js"]);
  assert.deepEqual(context.state.untracked, ["keep.txt"]);
  assert.deepEqual(context.nearby_context.map((entry) => entry.path).sort(), ["keep.txt", "src/app.js"]);
  assert.match(serialized, /reviewable untracked/);
  assert.doesNotMatch(serialized, /artifact-(context|module|runtime|scratch|log|temp)-secret/);
  assert.equal(estimateContext(context).bytes, Buffer.byteLength(serialized, "utf8"));
});

test("collects AGENTS.md and referenced Claude instruction files", () => {
  const repo = tempRepo("crg-instructions");
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), [
    "# Repo Instructions",
    "Main review context lives in `CLAUDE.md`.",
    "API_KEY=repo-instruction-secret",
  ].join("\n"));
  fs.writeFileSync(path.join(repo, "CLAUDE.md"), "Always review data-loss and rollback paths.\n");
  fs.writeFileSync(path.join(repo, "src", "app.js"), "console.log('base');\n");
  run("git", ["add", "."], repo);
  run("git", ["commit", "-m", "initial"], repo);
  fs.writeFileSync(path.join(repo, "src", "app.js"), "console.log('changed');\n");

  const context = collectReviewContext({
    cwd: repo,
    scope: "working-tree",
    includeNearbyContext: false,
    config: { redactSecrets: true, sendUntrackedFiles: true },
  });
  const instructions = Object.fromEntries(context.repo_instructions.map((entry) => [entry.path, entry]));

  assert.deepEqual(Object.keys(instructions).sort(), ["AGENTS.md", "CLAUDE.md"]);
  assert.match(instructions["AGENTS.md"].content, /Main review context/);
  assert.match(instructions["AGENTS.md"].content, /API_KEY=\[REDACTED\]/);
  assert.match(instructions["CLAUDE.md"].content, /data-loss/);
});

test("uses nearest AGENTS.md for nested cwd and still includes root Claude instructions", () => {
  const repo = tempRepo("crg-nested-instructions");
  fs.mkdirSync(path.join(repo, "packages", "api", "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "Root instructions.\n");
  fs.writeFileSync(path.join(repo, "CLAUDE.md"), "Root Claude memory.\n");
  fs.writeFileSync(path.join(repo, "packages", "api", "AGENTS.md"), "API package instructions.\n");
  fs.writeFileSync(path.join(repo, "packages", "api", "src", "app.js"), "console.log('base');\n");
  run("git", ["add", "."], repo);
  run("git", ["commit", "-m", "initial"], repo);
  fs.writeFileSync(path.join(repo, "packages", "api", "src", "app.js"), "console.log('changed');\n");

  const context = collectReviewContext({
    cwd: path.join(repo, "packages", "api"),
    scope: "working-tree",
    includeNearbyContext: false,
    config: { redactSecrets: false, sendUntrackedFiles: true },
  });
  const paths = context.repo_instructions.map((entry) => entry.path).sort();

  assert.deepEqual(paths, ["CLAUDE.md", "packages/api/AGENTS.md"]);
  assert.match(context.repo_instructions.find((entry) => entry.path === "packages/api/AGENTS.md").content, /API package/);
});
