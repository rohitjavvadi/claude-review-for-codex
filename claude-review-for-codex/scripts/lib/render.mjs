export function renderReview(reviewMarkdown, summary = {}) {
  const metadata = [
    `Review ID: ${summary.reviewId ?? "(unknown)"}`,
    `Mode: ${summary.mode ?? "(unknown)"}`,
    `Artifacts: ${summary.artifactDir ?? "(not saved)"}`,
  ].join("\n");
  return `${String(reviewMarkdown ?? "").trim()}\n\n---\n${metadata}\n`;
}

export function renderStatus({ jobs, reviews }) {
  const lines = ["Claude Review for Codex status", ""];
  lines.push("Jobs:");
  if (!jobs.length) lines.push("- none");
  for (const job of jobs) {
    lines.push(`- ${job.id}: ${job.status}${job.reviewId ? ` (review ${job.reviewId})` : ""}`);
  }
  lines.push("", "Reviews:");
  if (!reviews.length) lines.push("- none");
  for (const review of reviews.slice(0, 10)) {
    lines.push(`- ${review.id}: ${review.summary?.status ?? "unknown"} ${review.summary?.mode ? `(${review.summary.mode})` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}
