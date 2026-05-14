import fs from "node:fs";
import path from "node:path";

export function artifactRoot(repoRoot) {
  return path.join(repoRoot, ".codex", "claude-reviews");
}

export function safeId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function createReviewId(prefix = "review") {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-");
  const suffix = Math.random().toString(16).slice(2, 8);
  return `${prefix}-${stamp}-${suffix}`;
}

export function reviewDir(repoRoot, reviewId) {
  return path.join(artifactRoot(repoRoot), safeId(reviewId));
}

export function ensureArtifactDirs(repoRoot) {
  fs.mkdirSync(artifactRoot(repoRoot), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot(repoRoot), "jobs"), { recursive: true });
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, file);
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeReviewArtifacts(repoRoot, reviewId, files) {
  const dir = reviewDir(repoRoot, reviewId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (typeof value === "string") {
      fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`);
    } else {
      writeJson(file, value);
    }
  }
  return dir;
}

export function listReviews(repoRoot) {
  const root = artifactRoot(repoRoot);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "jobs")
    .map((entry) => {
      const dir = path.join(root, entry.name);
      const summaryPath = path.join(dir, "summary.json");
      let summary = null;
      if (fs.existsSync(summaryPath)) {
        try {
          summary = readJson(summaryPath);
        } catch {
          summary = null;
        }
      }
      return { id: entry.name, dir, summary };
    })
    .sort(compareReviews);
}

export function latestReview(repoRoot) {
  return listReviews(repoRoot)[0] ?? null;
}

function compareReviews(a, b) {
  const aTime = Date.parse(a.summary?.createdAt ?? "");
  const bTime = Date.parse(b.summary?.createdAt ?? "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  if (Number.isFinite(aTime) !== Number.isFinite(bTime)) {
    return Number.isFinite(bTime) ? 1 : -1;
  }
  return b.id.localeCompare(a.id);
}
