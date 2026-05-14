export function validateDecisions(value) {
  validateObject(value, "decisions");
  requireString(value, "review_id");
  requireArray(value, "decisions");
  for (const [index, decision] of value.decisions.entries()) {
    validateObject(decision, `decisions[${index}]`);
    requireString(decision, "finding_id");
    requireEnum(decision, "decision", ["accepted", "rejected", "deferred"]);
    requireString(decision, "reason");
    requireArray(decision, "files_changed_by_codex");
    requireArray(decision, "tests_run");
  }
  return true;
}

function validateObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function requireArray(value, key) {
  if (!Array.isArray(value[key])) {
    throw new Error(`${key} must be an array.`);
  }
}

function requireString(value, key) {
  if (typeof value[key] !== "string" || value[key].length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
}

function requireEnum(value, key, allowed) {
  if (!allowed.includes(value[key])) {
    throw new Error(`${key} must be one of: ${allowed.join(", ")}.`);
  }
}
