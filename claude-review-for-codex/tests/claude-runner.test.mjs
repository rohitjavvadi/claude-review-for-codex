import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs, normalizeClaudeEffort, normalizeClaudeModel, normalizeClaudeModelList } from "../scripts/lib/claude.mjs";

test("default Claude args are read-only and not bare", () => {
  const args = buildClaudeArgs({
    prompt: "review",
    model: "sonnet",
    maxTurns: 4,
    authMode: "subscription-cli",
  });
  assert.equal(args.includes("--bare"), false);
  assert.equal(args[0], "-p");
  assert.equal(args.includes("review"), false);
  assert.equal(args.includes("--json-schema"), false);
  assert.ok(args.includes("--output-format"));
  assert.ok(args.includes("text"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.ok(args.includes("--permission-mode"));
  assert.ok(args.includes("--tools"));
  assert.ok(args.includes("Read,Glob,Grep,LS"));
  assert.equal(args.includes("--max-budget-usd"), false);
  assert.match(args.join(" "), /Bash/);
  assert.match(args.join(" "), /Write/);
});

test("explicit budget flag is opt-in", () => {
  const args = buildClaudeArgs({
    maxBudgetUsd: 2,
  });
  assert.ok(args.includes("--max-budget-usd"));
  assert.ok(args.includes("2"));
});

test("api-key mode adds bare", () => {
  const args = buildClaudeArgs({
    prompt: "review",
    authMode: "api-key",
  });
  assert.ok(args.includes("--bare"));
});

test("friendly model names are normalized for Claude Code", () => {
  assert.equal(normalizeClaudeModel("opus 4.7"), "claude-opus-4-7");
  assert.equal(normalizeClaudeModel("Claude Sonnet 4.6"), "claude-sonnet-4-6");
  assert.equal(normalizeClaudeModel("fable 5"), "claude-fable-5");
  assert.equal(normalizeClaudeModel("Claude Fable 5"), "claude-fable-5");
  assert.equal(normalizeClaudeModel("mythos 5"), "claude-mythos-5");
  assert.equal(normalizeClaudeModel("mythos preview"), "claude-mythos-preview");
  assert.equal(normalizeClaudeModel("haiku 4.5"), "claude-haiku-4-5");
  assert.equal(normalizeClaudeModel("opus plan"), "opusplan");
  assert.equal(normalizeClaudeModel("opus"), "opus");

  const args = buildClaudeArgs({
    model: "opus 4.7",
  });
  assert.equal(args[args.indexOf("--model") + 1], "claude-opus-4-7");
});

test("dotted Claude shorthand model names are normalized", () => {
  assert.equal(normalizeClaudeModel("claude-opus-4.7"), "claude-opus-4-7");
  assert.equal(normalizeClaudeModel("claude-fable-5.0"), "claude-fable-5-0");
});

test("fallback model lists and effort aliases are normalized", () => {
  assert.equal(normalizeClaudeModelList("opus 4.8, sonnet 4.6"), "claude-opus-4-8,claude-sonnet-4-6");
  assert.equal(normalizeClaudeEffort("extra"), "xhigh");
  assert.equal(normalizeClaudeEffort("ultracode"), "xhigh");
});

test("unsupported optional flags are omitted", () => {
  const args = buildClaudeArgs({
    model: "opus",
    effort: "xhigh",
    fallbackModel: "opus 4.8",
    maxTurns: 4,
    authMode: "api-key",
    capabilities: {
      missingOptional: ["--bare", "--max-turns", "--model", "--effort", "--fallback-model"],
    },
  });
  assert.equal(args.includes("--bare"), false);
  assert.equal(args.includes("--max-turns"), false);
  assert.equal(args.includes("--model"), false);
  assert.equal(args.includes("--effort"), false);
  assert.equal(args.includes("--fallback-model"), false);
});

test("Claude args pass through effort and fallback model when supported", () => {
  const args = buildClaudeArgs({
    model: "fable 5",
    effort: "extra",
    fallbackModel: "opus 4.8,sonnet",
  });
  assert.equal(args[args.indexOf("--model") + 1], "claude-fable-5");
  assert.equal(args[args.indexOf("--effort") + 1], "xhigh");
  assert.equal(args[args.indexOf("--fallback-model") + 1], "claude-opus-4-8,sonnet");
});

test("implementation Claude args can allow write tools while denying shell and web", () => {
  const args = buildClaudeArgs({
    model: "sonnet",
    tools: ["Read", "Glob", "Grep", "LS", "Edit", "Write", "MultiEdit"],
    disallowedTools: ["NotebookEdit", "Bash", "WebFetch", "WebSearch"],
  });
  assert.ok(args.includes("Read,Glob,Grep,LS,Edit,Write,MultiEdit"));
  assert.ok(args.includes("NotebookEdit,Bash,WebFetch,WebSearch"));
  assert.equal(args.join(" ").includes("Edit,Write,MultiEdit,NotebookEdit"), false);
});
