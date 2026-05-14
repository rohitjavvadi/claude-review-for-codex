import test from "node:test";
import assert from "node:assert/strict";
import { validateDecisions } from "../scripts/lib/schema.mjs";

test("valid decisions pass", () => {
  assert.equal(validateDecisions({
    review_id: "review-1",
    decisions: [{
      finding_id: "CR-001",
      decision: "accepted",
      reason: "Confirmed locally.",
      files_changed_by_codex: ["src/app.js"],
      tests_run: ["npm test"]
    }]
  }), true);
});

test("invalid decisions fail", () => {
  assert.throws(() => validateDecisions({
    review_id: "review-1",
    decisions: [{
      finding_id: "CR-001",
      decision: "maybe",
      reason: "Nope.",
      files_changed_by_codex: [],
      tests_run: []
    }]
  }), /decision/);
});
