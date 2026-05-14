import test from "node:test";
import assert from "node:assert/strict";
import { redactJson, redactText } from "../scripts/lib/redaction.mjs";

test("redacts common secrets", () => {
  const input = [
    "ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnop",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
    "https://user:pass@example.com/path",
    "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
  ].join("\n");
  const result = redactText(input);
  assert.match(result.text, /\[REDACTED\]/);
  assert.doesNotMatch(result.text, /sk-ant-1234567890/);
  assert.doesNotMatch(result.text, /user:pass/);
  assert.ok(result.redactions.length >= 3);
});

test("does not redact camelCase source code identifiers", () => {
  const input = "if (config.redactSecrets === false) return rawContext;";
  const result = redactText(input);
  assert.equal(result.text, input);
  assert.deepEqual(result.redactions, []);
});

test("redacts JSON values without corrupting object structure", () => {
  const value = {
    code: "const SECRET_PATTERNS = [ { name: 'assignment-secret' } ];",
    env: "ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnop",
  };
  const result = redactJson(value);
  assert.equal(result.value.code, value.code);
  assert.match(result.value.env, /\[REDACTED\]/);
  assert.ok(result.redactions.length >= 1);
});
