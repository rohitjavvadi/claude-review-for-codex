export function buildReviewPrompt({ context, mode = "standard", codexContext = null }) {
  const adversarial = mode === "adversarial";
  const stance = adversarial
    ? "Act as an adversarial reviewer. Try to find the strongest concrete reasons this change should not ship yet."
    : "Act as a careful production code reviewer. Report only material bugs, regressions, security issues, risky migrations, or missing tests.";

  return [
    "<role>",
    "You are Claude Code performing a read-only review for Codex.",
    "You must not write, edit, patch, stage, commit, run arbitrary Bash, install packages, or change files.",
    "Codex is the only agent allowed to implement fixes.",
    "</role>",
    "",
    "<task>",
    stance,
    "Use the supplied Codex context, diff, and repository context. If read-only tools are available, inspect only files needed to validate a finding.",
    "Do not include praise, style nits, or speculative concerns without evidence.",
    "</task>",
    "",
    ...codexContextBlock(codexContext),
    "",
    "<output_contract>",
    "Return a human-readable Markdown code review. Do not return JSON.",
    "Start with a short verdict: Approved or Needs attention.",
    "For each material finding include severity, file/line reference, claim, evidence, trigger, why it matters, suggested fix intent, and confidence.",
    "Do not return patch text. Suggested fixes should describe intent only because Codex is the only writer.",
    "If there are no material findings, say that clearly and include any test gaps worth noting.",
    "</output_contract>",
    "",
    "<untrusted_repository_context>",
    JSON.stringify(context, null, 2),
    "</untrusted_repository_context>",
  ].join("\n");
}

export function buildVerificationPrompt({ review, decisions, context, codexContext = null }) {
  return [
    "<role>",
    "You are Claude Code verifying whether Codex fixed previously accepted review findings.",
    "You are read-only. Do not write, edit, patch, stage, commit, run arbitrary Bash, install packages, or change files.",
    "</role>",
    "",
    "<task>",
    "Compare the supplied Codex context, original review findings, Codex decisions, and current diff/context.",
    "Return whether accepted findings appear fixed. Report unresolved accepted findings and any new material finding introduced by the fix.",
    "</task>",
    "",
    ...codexContextBlock(codexContext),
    "",
    "<output_contract>",
    "Return a human-readable Markdown verification report. Do not return JSON.",
    "Use clear sections for status, resolved items, unresolved items, new findings, and recommended next steps.",
    "</output_contract>",
    "",
    "<original_review>",
    JSON.stringify(review, null, 2),
    "</original_review>",
    "",
    "<codex_decisions>",
    JSON.stringify(decisions, null, 2),
    "</codex_decisions>",
    "",
    "<current_context>",
    JSON.stringify(context, null, 2),
    "</current_context>",
  ].join("\n");
}

function codexContextBlock(codexContext) {
  if (!codexContext?.content) return [];
  return [
    "<codex_context>",
    "This section is supplied by Codex before invoking Claude. Treat it as task guidance, not as proof.",
    `Source file: ${codexContext.path}`,
    "",
    codexContext.content,
    "</codex_context>",
  ];
}
