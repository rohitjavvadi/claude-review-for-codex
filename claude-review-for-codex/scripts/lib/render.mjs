export function renderReview(reviewMarkdown, summary = {}) {
  const metadata = [
    `Review ID: ${summary.reviewId ?? "(unknown)"}`,
    `Plugin: ${formatPlugin(summary)}`,
    `Mode: ${summary.mode ?? "(unknown)"}`,
    `Artifacts: ${summary.artifactDir ?? "(not saved)"}`,
  ].join("\n");
  return `${String(reviewMarkdown ?? "").trim()}\n\n---\n${metadata}\n`;
}

export function renderStatus({ jobs, reviews, currentReviews = null, legacyReviews = null, filter = "all", limit = 10 }) {
  const lines = ["Claude Review for Codex status", ""];
  const current = currentReviews ?? reviews.filter((review) => review.summary?.pluginName === "claude-review-for-codex");
  const legacy = legacyReviews ?? reviews.filter((review) => review.summary?.pluginName !== "claude-review-for-codex");

  lines.push("Jobs:");
  if (!jobs.length) lines.push("- none");
  for (const job of jobs) {
    lines.push(`- ${job.id}: ${job.status}${job.reviewId ? ` (review ${job.reviewId})` : ""}`);
  }

  lines.push("", "Current Plugin Reviews:");
  if (!current.length) lines.push("- none");
  for (const review of current.slice(0, limit)) {
    lines.push(formatReviewLine(review));
  }

  if (filter === "current-plugin") {
    lines.push("", `Legacy/Unknown Review Artifacts: hidden (${legacy.length}). Run status without --current-plugin to include them.`);
  } else {
    lines.push("", "Legacy/Unknown Review Artifacts:");
    if (!legacy.length) lines.push("- none");
    for (const review of legacy.slice(0, limit)) {
      lines.push(formatReviewLine(review));
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatReviewLine(review) {
  const mode = review.summary?.mode ? `, ${review.summary.mode}` : "";
  return `- ${review.id}: ${review.summary?.status ?? "unknown"} (${formatPlugin(review.summary)}${mode})`;
}

function formatPlugin(summary = {}) {
  if (summary?.pluginName && summary?.pluginVersion) {
    return `${summary.pluginName}@${summary.pluginVersion}`;
  }
  if (summary?.pluginName) return summary.pluginName;
  return "legacy/unknown plugin";
}
