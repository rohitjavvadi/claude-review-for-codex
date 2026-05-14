import test from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs } from "../scripts/lib/claude.mjs";

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

test("unsupported optional flags are omitted", () => {
  const args = buildClaudeArgs({
    model: "opus",
    maxTurns: 4,
    authMode: "api-key",
    capabilities: {
      missingOptional: ["--bare", "--max-turns", "--model"],
    },
  });
  assert.equal(args.includes("--bare"), false);
  assert.equal(args.includes("--max-turns"), false);
  assert.equal(args.includes("--model"), false);
});
