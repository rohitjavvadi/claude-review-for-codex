import fs from "node:fs";
import path from "node:path";
import { runCommand, runCommandChecked } from "./process.mjs";
import { redactJson } from "./redaction.mjs";

const MAX_DIFF_BYTES = 256 * 1024;
const MAX_UNTRACKED_BYTES = 24 * 1024;
const MAX_NEARBY_BYTES_PER_FILE = 24 * 1024;
const MAX_INSTRUCTION_BYTES_PER_FILE = 32 * 1024;
const CLAUDE_INSTRUCTION_CANDIDATES = [
  "CLAUDE.md",
  "claude.md",
  ".claude/CLAUDE.md",
  ".claude/claude.md",
];
const REVIEW_CONTEXT_EXCLUDE_PATHSPECS = [
  ":(exclude).codex/claude-reviews/**",
  ":(exclude).git/**",
  ":(exclude)node_modules/**",
  ":(exclude)logs/**",
  ":(exclude)log/**",
  ":(exclude)tmp/**",
  ":(exclude)temp/**",
  ":(exclude).tmp/**",
  ":(exclude)*.log",
  ":(exclude)*.tmp",
  ":(exclude)*.temp",
  ":(exclude)**/*.log",
  ":(exclude)**/*.tmp",
  ":(exclude)**/*.temp",
];

function normalizeGitPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isReviewContextExcluded(relativePath) {
  const normalized = normalizeGitPath(relativePath);
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";
  return normalized.startsWith(".codex/claude-reviews/")
    || segments.includes(".git")
    || segments.includes("node_modules")
    || segments.includes("logs")
    || segments.includes("log")
    || segments.includes("tmp")
    || segments.includes("temp")
    || segments.includes(".tmp")
    || basename.endsWith(".log")
    || basename.endsWith(".tmp")
    || basename.endsWith(".temp");
}

function filterReviewableFiles(files) {
  return files.filter((file) => !isReviewContextExcluded(file));
}

function reviewContextPathspecs() {
  return ["--", ".", ...REVIEW_CONTEXT_EXCLUDE_PATHSPECS];
}

export function ensureGitRepository(cwd) {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (result.error) {
    throw new Error("git is not installed or not available in PATH.");
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

export function getCurrentBranch(repoRoot) {
  const result = runCommand("git", ["branch", "--show-current"], { cwd: repoRoot });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : "HEAD";
}

export function detectDefaultBranch(repoRoot) {
  const remote = runCommand("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: repoRoot });
  if (remote.status === 0 && remote.stdout.includes("refs/remotes/origin/")) {
    return remote.stdout.trim().replace("refs/remotes/origin/", "");
  }
  for (const candidate of ["main", "master", "trunk"]) {
    if (runCommand("git", ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], { cwd: repoRoot }).status === 0) {
      return candidate;
    }
    if (runCommand("git", ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`], { cwd: repoRoot }).status === 0) {
      return `origin/${candidate}`;
    }
  }
  return null;
}

export function getWorkingTreeState(repoRoot) {
  const staged = filterReviewableFiles(runCommandChecked("git", ["diff", "--cached", "--name-only", ...reviewContextPathspecs()], { cwd: repoRoot }).stdout.trim().split("\n").filter(Boolean));
  const unstaged = filterReviewableFiles(runCommandChecked("git", ["diff", "--name-only", ...reviewContextPathspecs()], { cwd: repoRoot }).stdout.trim().split("\n").filter(Boolean));
  const untracked = filterReviewableFiles(runCommandChecked("git", ["ls-files", "--others", "--exclude-standard", ...reviewContextPathspecs()], { cwd: repoRoot }).stdout.trim().split("\n").filter(Boolean));
  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
  };
}

function readBoundedGit(repoRoot, args, maxBytes = MAX_DIFF_BYTES) {
  const result = runCommand("git", args, { cwd: repoRoot, maxBuffer: maxBytes + 8192 });
  if (result.error?.code === "ENOBUFS") {
    return { text: "", omitted: true, reason: `output exceeded ${maxBytes} bytes` };
  }
  if (result.error) {
    throw new Error(`${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  if (Buffer.byteLength(result.stdout, "utf8") > maxBytes) {
    return { text: "", omitted: true, reason: `output exceeded ${maxBytes} bytes` };
  }
  return { text: result.stdout, omitted: false, reason: null };
}

function isProbablyText(buffer) {
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
  }
  return suspicious / Math.max(sample.length, 1) < 0.05;
}

function readUntrackedFile(repoRoot, relativePath) {
  const absolute = path.join(repoRoot, relativePath);
  const stat = fs.lstatSync(absolute);
  if (stat.isDirectory()) return { path: relativePath, omitted: true, reason: "directory" };
  if (stat.isSymbolicLink()) return { path: relativePath, omitted: true, reason: "symlink" };
  if (stat.size > MAX_UNTRACKED_BYTES) return { path: relativePath, omitted: true, reason: `larger than ${MAX_UNTRACKED_BYTES} bytes` };
  const buffer = fs.readFileSync(absolute);
  if (!isProbablyText(buffer)) return { path: relativePath, omitted: true, reason: "binary" };
  return { path: relativePath, omitted: false, content: buffer.toString("utf8") };
}

function readNearbyContext(repoRoot, files) {
  const contexts = [];
  for (const relativePath of files.slice(0, 40)) {
    const absolute = path.join(repoRoot, relativePath);
    try {
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.size > MAX_NEARBY_BYTES_PER_FILE) continue;
      const buffer = fs.readFileSync(absolute);
      if (!isProbablyText(buffer)) continue;
      contexts.push({
        path: relativePath,
        content: buffer.toString("utf8"),
      });
    } catch {
      // Deleted files are already represented in the diff.
    }
  }
  return contexts;
}

function discoverRepoInstructions(repoRoot, cwd) {
  const entries = [];
  const seen = new Set();
  const seenFileKeys = new Set();
  const repoRootReal = realPathOrNull(repoRoot) ?? path.resolve(repoRoot);

  function addInstructionFile(absolutePath, source) {
    const realAbsolutePath = realPathOrNull(absolutePath);
    if (!realAbsolutePath) return null;
    let stat;
    try {
      stat = fs.lstatSync(realAbsolutePath);
    } catch {
      return null;
    }
    const fileKey = `${stat.dev}:${stat.ino}`;
    if (seenFileKeys.has(fileKey)) return null;
    const relative = normalizeGitPath(path.relative(repoRootReal, realAbsolutePath));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || seen.has(relative)) return null;
    seenFileKeys.add(fileKey);
    seen.add(relative);
    try {
      if (!stat.isFile()) {
        const entry = { path: relative, source, omitted: true, reason: "not a file" };
        entries.push(entry);
        return entry;
      }
      if (stat.size > MAX_INSTRUCTION_BYTES_PER_FILE) {
        const entry = { path: relative, source, omitted: true, reason: `larger than ${MAX_INSTRUCTION_BYTES_PER_FILE} bytes` };
        entries.push(entry);
        return entry;
      }
      const buffer = fs.readFileSync(realAbsolutePath);
      if (!isProbablyText(buffer)) {
        const entry = { path: relative, source, omitted: true, reason: "binary" };
        entries.push(entry);
        return entry;
      }
      const entry = { path: relative, source, omitted: false, content: buffer.toString("utf8") };
      entries.push(entry);
      return entry;
    } catch {
      return null;
    }
  }

  const agents = findNearestAgentsFile(repoRoot, cwd);
  if (agents) {
    const agentEntry = addInstructionFile(agents, "nearest AGENTS.md");
    if (agentEntry?.content) {
      for (const pointer of findMarkdownPointers(agentEntry.content)) {
        addInstructionFile(path.resolve(path.dirname(agents), pointer), `referenced by ${agentEntry.path}`);
      }
      for (const candidate of CLAUDE_INSTRUCTION_CANDIDATES) {
        if (agentEntry.content.includes(candidate)) {
          addInstructionFile(path.resolve(path.dirname(agents), candidate), `referenced by ${agentEntry.path}`);
        }
      }
    }
  }

  for (const candidate of CLAUDE_INSTRUCTION_CANDIDATES) {
    addInstructionFile(path.join(repoRoot, candidate), "root Claude instructions");
  }

  return entries;
}

function findNearestAgentsFile(repoRoot, cwd) {
  const root = realPathOrNull(repoRoot) ?? path.resolve(repoRoot);
  let current = realPathOrNull(cwd) ?? path.resolve(cwd);
  try {
    if (fs.existsSync(current) && fs.lstatSync(current).isFile()) {
      current = path.dirname(current);
    }
  } catch {
    current = repoRoot;
  }
  if (path.relative(root, current).startsWith("..")) {
    current = root;
  }
  while (true) {
    const candidate = path.join(current, "AGENTS.md");
    if (fs.existsSync(candidate)) return candidate;
    if (current === root) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function realPathOrNull(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function findMarkdownPointers(content) {
  const pointers = new Set();
  const fencedPath = /`([^`\n]+\.md)`/gi;
  for (const match of content.matchAll(fencedPath)) {
    const pointer = match[1].trim();
    if (!pointer || pointer.includes("://") || path.isAbsolute(pointer)) continue;
    pointers.add(pointer);
  }
  return pointers;
}

export function collectReviewContext(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = ensureGitRepository(cwd);
  const config = options.config ?? {};
  const state = getWorkingTreeState(repoRoot);
  const branch = getCurrentBranch(repoRoot);
  const baseRef = options.base ?? null;
  const scope = options.scope ?? (baseRef ? "branch" : state.isDirty ? "working-tree" : "branch");
  const effectiveBase = baseRef ?? (scope === "branch" ? detectDefaultBranch(repoRoot) : null);

  let target;
  let sections;
  let changedFiles;

  if (scope === "branch") {
    if (!effectiveBase) {
      throw new Error("Unable to detect a base branch. Pass --base <ref> or use --scope working-tree.");
    }
    const mergeBase = runCommandChecked("git", ["merge-base", "HEAD", effectiveBase], { cwd: repoRoot }).stdout.trim();
    const range = `${mergeBase}..HEAD`;
    target = { scope: "branch", baseRef: effectiveBase, mergeBase, label: `branch diff against ${effectiveBase}` };
    sections = {
      commit_log: readBoundedGit(repoRoot, ["log", "--oneline", "--decorate", range, ...reviewContextPathspecs()], 64 * 1024),
      diff_stat: readBoundedGit(repoRoot, ["diff", "--stat", range, ...reviewContextPathspecs()], 64 * 1024),
      diff: readBoundedGit(repoRoot, ["diff", "--find-renames", "--find-copies", "--no-ext-diff", "--submodule=diff", range, ...reviewContextPathspecs()]),
    };
    changedFiles = filterReviewableFiles(runCommandChecked("git", ["diff", "--name-only", range, ...reviewContextPathspecs()], { cwd: repoRoot }).stdout.trim().split("\n").filter(Boolean));
  } else {
    target = { scope: "working-tree", label: "working tree diff" };
    sections = {
      status: readBoundedGit(repoRoot, ["status", "--short", ...reviewContextPathspecs()], 64 * 1024),
      staged_diff: readBoundedGit(repoRoot, ["diff", "--cached", "--find-renames", "--find-copies", "--no-ext-diff", "--submodule=diff", ...reviewContextPathspecs()]),
      unstaged_diff: readBoundedGit(repoRoot, ["diff", "--find-renames", "--find-copies", "--no-ext-diff", "--submodule=diff", ...reviewContextPathspecs()]),
    };
    const untracked = config.sendUntrackedFiles === false ? [] : state.untracked.map((file) => readUntrackedFile(repoRoot, file));
    sections.untracked_files = { omitted: false, text: JSON.stringify(untracked, null, 2), reason: null };
    changedFiles = [...new Set([...state.staged, ...state.unstaged, ...state.untracked])];
  }

  const nearbyContext = options.includeNearbyContext ? readNearbyContext(repoRoot, changedFiles) : [];
  const repoInstructions = discoverRepoInstructions(repoRoot, cwd);
  const rawContext = {
    generated_at: new Date().toISOString(),
    repoRoot,
    branch,
    target,
    state,
    changed_files: changedFiles,
    sections,
    repo_instructions: repoInstructions,
    nearby_context: nearbyContext,
    user_intent: options.userIntent ?? "",
  };

  if (config.redactSecrets === false) {
    return { ...rawContext, redactions: [] };
  }
  const redacted = redactJson(rawContext);
  return { ...redacted.value, redactions: redacted.redactions };
}

export function estimateContext(context) {
  const bytes = Buffer.byteLength(JSON.stringify(context), "utf8");
  return {
    bytes,
    approxTokens: Math.ceil(bytes / 4),
    warning: bytes > 900_000 ? "large context; consider --mode cheap or a narrower --base/--scope" : null,
  };
}
